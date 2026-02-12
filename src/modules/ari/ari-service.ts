import { ARIRestClient } from './rest-client';
import { ChannelManager } from './channel-manager';
import { ARIEventHandler } from './event-handler';
import { Call, ServerConfig } from './types';
import { ARIConfig } from '../../config/ari-config';
import { WebSocketService } from '../websocket/websocket-service';
import { CallStore } from '../../store/call-store';

/**
 * Servicio principal de ARI
 * - Gestiona múltiples servidores Asterisk
 * - Origina llamadas
 * - Maneja el ciclo de vida de canales
 */
export class ARIService {
    private static instance: ARIService;
    private servers: Map<string, ARIRestClient> = new Map();
    private serverConfigs: Map<string, ServerConfig> = new Map();
    private activeChannels: Map<string, ChannelManager> = new Map();
    private channelAnswerTimes: Map<string, Date> = new Map();
    private completedChannels: Set<string> = new Set();
    private updateInterval: NodeJS.Timeout | null = null;
    private eventHandler: ARIEventHandler;
    private webSocketService: WebSocketService;
    private callStore: CallStore;
    
    private constructor() {
        this.eventHandler = new ARIEventHandler();
        this.webSocketService = WebSocketService.getInstance();
        this.callStore = CallStore.getInstance();
        this.setupEventHandlers();
    }
    
    public static getInstance(): ARIService {
        if (!ARIService.instance) {
            ARIService.instance = new ARIService();
        }
        return ARIService.instance;
    }
    
    /**
     * Configura los manejadores de eventos ARI
     */
    private setupEventHandlers(): void {
        this.eventHandler.on('channel_ringing', (data) => {
            
            // Enviar estado 'ringing' como el sistema antiguo
            this.webSocketService.sendToCallId(data.channelId, {
                callId: data.channelId,
                status: 'ringing',
                callDuration: '',
                hangupCause: ''
            });
        });
        
        this.eventHandler.on('channel_entered_stasis', async (data) => {
            
            // No enviar notificación stasis_start (no existía en sistema antiguo)
            
            // Contestar el canal automáticamente cuando entre en Stasis
            const client = this.servers.get(data.serverId);
            if (client) {
                try {
                    await client.answer(data.channelId);
                    
                    // Guardar tiempo de respuesta para calcular duración
                    this.channelAnswerTimes.set(data.channelId, new Date());
                    
                    // Enviar estado 'answered' como el sistema antiguo
                    this.webSocketService.sendToCallId(data.channelId, {
                        callId: data.channelId,
                        status: 'answered',
                        callDuration: '',
                        hangupCause: ''
                    });
                    
                    // AHORA iniciar el IVR después de contestar
                    const manager = this.activeChannels.get(data.channelId);
                    if (manager) {
                        await manager.start();
                        
                        // No enviar notificación - el sistema antiguo no enviaba ivr_started
                    }
                } catch (error) {
                    console.error(`❌ Error contestando canal ${data.channelId}:`, error);
                    
                    // Notificar WebSocket - error
                    this.webSocketService.sendCallStatus(data.channelId, 'error', {
                        serverId: data.serverId,
                        message: 'Error contestando llamada',
                        error: error instanceof Error ? error.message : 'Error desconocido'
                    });
                }
            }
        });
        
        // DTMF DEBE manejarse para el bargein - igual que en el sistema antiguo
        this.eventHandler.on('dtmf_received', (data) => {
            
            // NO enviar notificación WebSocket individual de DTMF
            // Las notificaciones completas se envían desde action-controller cuando se completa el gather
            
            this.handleDTMF(data.channelId, data.digit);
        });
        
        this.eventHandler.on('playback_finished', (data) => {
            this.handlePlaybackFinished(data.channelId, data.playbackId);
        });
        
        this.eventHandler.on('channel_hangup', (data) => {
            
            // Evitar envío duplicado de COMPLETED
            if (this.completedChannels.has(data.channelId)) {
                return;
            }
            this.completedChannels.add(data.channelId);
            
            // Calcular duración de la llamada
            const answerTime = this.channelAnswerTimes.get(data.channelId);
            let duration = '';
            if (answerTime) {
                const durationSeconds = Math.round((new Date().getTime() - answerTime.getTime()) / 1000);
                duration = durationSeconds.toString();
                this.channelAnswerTimes.delete(data.channelId);
            }
            
            // Enviar estado 'completed' como el sistema antiguo
            const hangupCause = this.translateHangupCause(data.cause);
            this.webSocketService.sendToCallId(data.channelId, {
                callId: data.channelId,
                status: 'completed',
                callDuration: duration,
                hangupCause: hangupCause
            });
            
            // LIMPIEZA COMPLETA de todos los recursos de la llamada
            this.cleanupCall(data.channelId);
            
        });
        
        this.eventHandler.on('server_connected', (data) => {
        });
        
        this.eventHandler.on('server_failed', (data) => {
            console.error(`❌ Servidor ARI falló permanentemente: ${data.serverId}`);
        });
    }
    
    /**
     * Inicializa el servicio ARI con un servidor específico
     * @param serverIp IP del servidor FreePBX (opcional, puede venir de variable de entorno)
     */
    public async initialize(serverIp?: string): Promise<void> {
        const ip = serverIp || process.env.FREEPBX_IP;
        
        if (!ip) {
            throw new Error('❌ No se proporcionó la IP del servidor FreePBX. Usa: node dist/index.js <IP> o FREEPBX_IP=<IP>');
        }
        
        // Registrar el servidor con credenciales fijas
        const serverId = this.registerServerByIp(ip);
        
        console.log(`✅ Servidor ARI registrado: ${serverId} (${ip})`);
    }
    
    /**
     * Registra un servidor ARI por IP usando credenciales fijas
     * @param ip IP del servidor FreePBX
     * @returns serverId único generado
     */
    public registerServerByIp(ip: string): string {
        // Usar la IP como serverId (o generar uno único)
        const serverId = ip.replace(/\./g, '_'); // Reemplazar puntos por guiones bajos
        
        // Si ya existe, no hacer nada
        if (this.servers.has(serverId)) {
            return serverId;
        }
        
        // Crear configuración del servidor con credenciales fijas
        const config: ServerConfig = {
            host: ip,
            username: ARIConfig.ARI_USERNAME,
            password: ARIConfig.ARI_PASSWORD
        };
        
        // Crear cliente ARI
        const client = new ARIRestClient(config);
        this.servers.set(serverId, client);
        this.serverConfigs.set(serverId, config);
        
        // Conectar WebSocket para eventos
        this.eventHandler.connectToServer(serverId, config, client.appName);
        
        return serverId;
    }
    
    /**
     * Obtiene el primer (y único) serverId registrado
     * Útil cuando solo hay un servidor registrado por IP
     */
    public getCurrentServerId(): string | null {
        if (this.servers.size === 0) {
            return null;
        }
        // Retornar el primer serverId disponible
        return Array.from(this.servers.keys())[0];
    }
    
    /**
     * Detiene el servicio
     */
    public stop(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        // Desconectar todos los WebSockets
        this.eventHandler.disconnectAll();
        
    }
    
    /**
     * Configura un servidor ARI manualmente (opcional)
     */
    public configureServer(serverId: string, config: ServerConfig): void {
        const client = new ARIRestClient(config);
        this.servers.set(serverId, client);
    }
    
    /**
     * Origina una llamada
     */
    public async originateCall(serverId: string, call: Call): Promise<{ success: boolean; channelId?: string; error?: string }> {
        try {
            const client = this.servers.get(serverId);
            if (!client) {
                return {
                    success: false,
                    error: `Servidor ${serverId} no configurado`
                };
            }
            
            // Crear canal en Asterisk
            const channelId = this.generateCallId();
            const channelData = await client.createChannel(call, channelId);
            
            // Crear manager para el canal
            const manager = new ChannelManager(call, client, channelId);
            this.activeChannels.set(channelId, manager);
            
            
            return {
                success: true,
                channelId: channelId
            };
            
        } catch (error) {
            console.error('Error originando llamada:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Error desconocido'
            };
        }
    }
    
    /**
     * Termina una llamada
     */
    public async hangupCall(channelId: string): Promise<{ success: boolean; message: string }> {
        try {
            const manager = this.activeChannels.get(channelId);
            if (!manager) {
                return {
                    success: false,
                    message: 'Canal no encontrado'
                };
            }
            
            // Destruir el canal
            await manager.api.hangup(channelId);
            manager.destroy();
            this.activeChannels.delete(channelId);
            
            
            return {
                success: true,
                message: 'Llamada terminada correctamente'
            };
            
        } catch (error) {
            console.error('Error terminando llamada:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Error desconocido'
            };
        }
    }
    
    /**
     * Maneja eventos DTMF
     */
    public async handleDTMF(channelId: string, digit: string): Promise<void> {
        const manager = this.activeChannels.get(channelId);
        if (manager) {
            await manager.onDTMFReceived(digit);
        }
    }
    
    /**
     * Maneja fin de playback
     */
    public async handlePlaybackFinished(channelId: string, playbackId?: string): Promise<void> {
        const manager = this.activeChannels.get(channelId);
        if (manager) {
            await manager.onPlaybackFinished(playbackId);
        } else {
            // Manager ya destruido: ignorar silenciosamente
        }
    }
    
    /**
     * Obtiene información de un canal activo
     */
    public getChannelInfo(channelId: string): ChannelManager | undefined {
        return this.activeChannels.get(channelId);
    }
    
    /**
     * Lista todos los canales activos
     */
    public getActiveChannels(): string[] {
        return Array.from(this.activeChannels.keys());
    }
    
    /**
     * Cambia la acción de una llamada activa (para validación OTP)
     */
    public async setChannelAction(channelId: string, actionUrl: string): Promise<{ success: boolean; message: string }> {
        try {
            const manager = this.activeChannels.get(channelId);
            if (!manager) {
                return {
                    success: false,
                    message: 'Canal no encontrado'
                };
            }
            
            await manager.setAction(actionUrl);
            
            
            return {
                success: true,
                message: 'Acción cambiada correctamente'
            };
            
        } catch (error) {
            console.error('Error cambiando acción del canal:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Error desconocido'
            };
        }
    }
    
    /**
     * Obtiene estadísticas del servicio
     */
    public getStats() {
        return {
            serversConfigured: this.servers.size,
            activeChannels: this.activeChannels.size,
            servers: Array.from(this.servers.keys()),
            timestamp: new Date().toISOString()
        };
    }
    
    private generateCallId(): string {
        return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Traduce códigos de hangup a texto legible
     */
    private translateHangupCause(cause: any): string {
        const causeMap: { [key: string]: string } = {
            '16': 'normal',
            '17': 'busy',
            '18': 'no-answer',
            '19': 'no-answer',
            '21': 'rejected',
            '34': 'congestion'
        };
        
        if (typeof cause === 'number') {
            return causeMap[cause.toString()] || 'unknown';
        }
        if (typeof cause === 'string') {
            return causeMap[cause] || cause;
        }
        return 'unknown';
    }
    
    /**
     * Limpia todos los recursos asociados a una llamada completada
     */
    private cleanupCall(channelId: string): void {
        try {
            // 1. Eliminar del CallStore (código en memoria)
            this.callStore.removeCall(channelId);
            
            // 2. Eliminar ChannelManager activo
            const manager = this.activeChannels.get(channelId);
            if (manager) {
                // No llamar a destroy aquí para evitar doble colgado; el manager ya debió destruir el canal
                this.activeChannels.delete(channelId);
            }
            
            // 3. Limpiar tiempo de respuesta
            this.channelAnswerTimes.delete(channelId);
            
            // 4. Limpiar del set de completados (después de un delay)
            setTimeout(() => {
                this.completedChannels.delete(channelId);
            }, 30000);
            
            // 5. Cerrar conexión WebSocket después de un delay
            setTimeout(() => {
                this.webSocketService.closeConnection(channelId);
            }, 5000);
            
            
        } catch (error) {
            console.error(`❌ Error limpiando recursos para ${channelId}:`, error);
        }
    }
} 