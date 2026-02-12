import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { ServerConfig } from './types';

export class ARIEventHandler extends EventEmitter {
    private connections: Map<string, WebSocket> = new Map();
    private reconnectAttempts: Map<string, number> = new Map();
    private maxReconnectAttempts = 5;
    private reconnectDelay = 5000;
    private processedPlaybacks: Set<string> = new Set();

    /**
     * Conecta a un servidor FreePBX vía WebSocket
     */
    public async connectToServer(serverId: string, config: ServerConfig, appName: string): Promise<void> {
        try {
            const wsUrl = `ws://${config.host}:8088/ari/events?app=${appName}&api_key=${config.username}:${config.password}`;
            
            
            const ws = new WebSocket(wsUrl);
            
            ws.on('open', () => {
                this.connections.set(serverId, ws);
                this.reconnectAttempts.set(serverId, 0);
                
                // Emitir evento de conexión
                this.emit('server_connected', { serverId, appName });
            });
            
            ws.on('message', (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    this.handleAriEvent(serverId, event);
                } catch (error) {
                    console.error(`❌ Error parseando evento ARI de ${serverId}:`, error);
                }
            });
            
            ws.on('close', (code, reason) => {
                this.connections.delete(serverId);
                
                // Intentar reconectar
                this.attemptReconnect(serverId, config, appName);
            });
            
            ws.on('error', (error) => {
                console.error(`❌ Error WebSocket ARI ${serverId}:`, error);
                this.connections.delete(serverId);
                
                // Intentar reconectar
                this.attemptReconnect(serverId, config, appName);
            });
            
        } catch (error) {
            console.error(`❌ Error conectando a servidor ARI ${serverId}:`, error);
            this.attemptReconnect(serverId, config, appName);
        }
    }
    
    /**
     * Maneja eventos ARI recibidos
     */
    private handleAriEvent(serverId: string, event: any): void {
        

        switch (event.type) {
            case 'StasisStart':
                this.emit('channel_entered_stasis', {
                    serverId,
                    channelId: event.channel.id,
                    channel: event.channel,
                    args: event.args
                });
                break;
                
            case 'StasisEnd':
                this.emit('channel_left_stasis', {
                    serverId,
                    channelId: event.channel.id,
                    channel: event.channel
                });
                break;
                
            case 'ChannelDtmfReceived':
                this.emit('dtmf_received', {
                    serverId,
                    channelId: event.channel.id,
                    digit: event.digit
                });
                break;
                
            case 'PlaybackFinished':
                // Deduplicar eventos PlaybackFinished por playback.id
                const pbId: string = event.playback.id;
                if (this.processedPlaybacks.has(pbId)) {
                    return;
                }
                this.processedPlaybacks.add(pbId);
                setTimeout(() => this.processedPlaybacks.delete(pbId), 30000);

                let channelId = event.playback.target_uri?.split('/').pop();
                
                // Limpiar prefijo "channel:" si existe
                if (channelId && channelId.startsWith('channel:')) {
                    channelId = channelId.replace('channel:', '');
                }
                
                
                this.emit('playback_finished', {
                    serverId,
                    playbackId: pbId,
                    channelId: channelId
                });
                break;
                
            case 'ChannelStateChange':
                // Detectar cuando el canal está realmente sonando
                if (event.channel.state === 'Ringing') {
                    this.emit('channel_ringing', {
                        serverId,
                        channelId: event.channel.id
                    });
                }
                break;
                
            case 'ChannelHangupRequest':
            case 'ChannelDestroyed':
                this.emit('channel_hangup', {
                    serverId,
                    channelId: event.channel.id,
                    cause: event.cause
                });
                break;
                
            default:
                // Emitir evento genérico para otros tipos
                this.emit('ari_event', {
                    serverId,
                    type: event.type,
                    event
                });
        }
    }
    
    /**
     * Intenta reconectar a un servidor
     */
    private attemptReconnect(serverId: string, config: ServerConfig, appName: string): void {
        const attempts = this.reconnectAttempts.get(serverId) || 0;
        
        if (attempts < this.maxReconnectAttempts) {
            const nextAttempt = attempts + 1;
            this.reconnectAttempts.set(serverId, nextAttempt);
            
            
            setTimeout(() => {
                this.connectToServer(serverId, config, appName);
            }, this.reconnectDelay);
        } else {
            console.error(`❌ Máximo de reintentos alcanzado para servidor ARI ${serverId}`);
            this.emit('server_failed', { serverId });
        }
    }
    
    /**
     * Desconecta de un servidor específico
     */
    public disconnectServer(serverId: string): void {
        const ws = this.connections.get(serverId);
        if (ws) {
            ws.close();
            this.connections.delete(serverId);
        }
    }
    
    /**
     * Desconecta de todos los servidores
     */
    public disconnectAll(): void {
        this.connections.forEach((ws, serverId) => {
            ws.close();
        });
        this.connections.clear();
        this.reconnectAttempts.clear();
    }
    
    /**
     * Obtiene el estado de conexiones
     */
    public getConnectionStatus(): { [serverId: string]: boolean } {
        const status: { [serverId: string]: boolean } = {};
        
        this.connections.forEach((ws, serverId) => {
            status[serverId] = ws.readyState === WebSocket.OPEN;
        });
        
        return status;
    }
} 