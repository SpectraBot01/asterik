import { Request, Response } from 'express';
import { TrunkStore } from '../../store/trunk-store';
import { CallStore } from '../../store/call-store';
import { ARIService } from '../../modules/ari/ari-service';
import { Call } from '../../modules/ari/types';
import { TrunkService } from '../../modules/trunks/trunk-service';
import { QueueManager } from '../../modules/queue/queue-manager';

/**
 * Controlador para los endpoints de llamadas
 */
export class CallController {
    private trunkStore: TrunkStore;
    private callStore: CallStore;
    private ariService: ARIService;
    private trunkService: TrunkService;
    private queueManager: QueueManager;
    
    constructor() {
        this.trunkStore = TrunkStore.getInstance();
        this.callStore = CallStore.getInstance();
        this.ariService = ARIService.getInstance();
        this.trunkService = TrunkService.getInstance();
        this.queueManager = QueueManager.getInstance();
    }
    
    /**
     * POST /api/calls/create
     * Crea una llamada usando un trunk asignado
     */
    public createCall = async (req: Request, res: Response): Promise<void> => {
        const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            const { phone_number, campaign, assignment_uuid } = req.body;
            
            
            // Validar parámetros requeridos
            if (!phone_number || !campaign || !assignment_uuid) {
                console.log(`❌ [${requestId}] Faltan parámetros requeridos`);
                res.status(400).json({
                    success: false,
                    error: 'phone_number, campaign y assignment_uuid son requeridos'
                });
                return;
            }
            
            // Buscar trunk por assignment_uuid en el store
            const trunkInfo = this.trunkStore.getTrunkByAssignment(assignment_uuid);
            if (!trunkInfo) {
                console.log(`❌ [${requestId}] Assignment UUID no encontrado o expirado`);
                res.status(404).json({
                    success: false,
                    error: 'Assignment UUID no encontrado o expirado'
                });
                return;
            }
            
            
            
            // MANTENER VIVO el trunk (resetear timeout a 2 minutos)
            const keepAliveResult = this.trunkService.keepAlive(assignment_uuid);

            // Seleccionar número aleatorio si hay múltiples números separados por comas
            const phoneNumbers = trunkInfo.trunk_data.phone_number.split(',').map(num => num.trim());
            
            const selectedIndex = Math.floor(Math.random() * phoneNumbers.length);
            const selectedPhoneNumber = phoneNumbers[selectedIndex];
            
            // Preparar datos de la llamada
            const call: Call = {
                to_number: phone_number,
                from_number: selectedPhoneNumber,
                trunk: trunkInfo.trunk_data.trunk_id,
                action_url: this.buildActionUrl(campaign)
            };
            
            
            
            // ENCOLAR la llamada por trunk (rate limiting 1.1s)
            try {
                const result = await this.queueManager.enqueue(
                    trunkInfo.trunk_data.trunk_id,
                    async () => {
                        
                        // Función que se ejecuta en la cola
                        // Obtener el serverId del servidor registrado (ya no viene en trunk_data)
                        const serverId = this.ariService.getCurrentServerId();
                        if (!serverId) {
                            throw new Error('No hay servidor ARI registrado');
                        }
                        
                        const originateResult = await this.ariService.originateCall(
                            serverId,
                            call
                        );
                        
                        
                        
                        if (originateResult.success) {
                            // Guardar datos de la llamada en memoria
                            this.callStore.saveCall(originateResult.channelId!, 'pending', campaign);
                            return originateResult;
                        } else {
                            console.log(`❌ [${requestId}] Error en originateCall: ${originateResult.error}`);
                            throw new Error(originateResult.error || 'Error originando llamada');
                        }
                    }
                );
                
                
                
                res.status(200).json({
                    success: true,
                    call_id: result.channelId
                });
                
            } catch (error) {
                console.error(`❌ [${requestId}] Error en cola para trunk ${trunkInfo.trunk_data.trunk_id}:`, error);
                res.status(500).json({
                    success: false,
                    error: error instanceof Error ? error.message : 'Error desconocido'
                });
            }
            
        } catch (error) {
            console.error(`❌ [${requestId}] Error general en createCall:`, error);
            res.status(500).json({
                success: false,
                error: 'Error interno del servidor'
            });
        }
        
    };
    
    /**
     * POST /api/calls/:id/destroy
     * Termina una llamada y libera el trunk
     */
    public destroyCall = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id: callId } = req.params;
            
            if (!callId) {
                res.status(400).json({
                    success: false,
                    error: 'call_id es requerido'
                });
                return;
            }
            
            // Terminar llamada vía ARI
            const result = await this.ariService.hangupCall(callId);
            
            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: result.message
                });
            } else {
                res.status(404).json({
                    success: false,
                    error: result.message
                });
            }
            
        } catch (error) {
            console.error('❌ Error en destroyCall:', error);
            res.status(500).json({
                success: false,
                error: 'Error interno del servidor'
            });
        }
    };
    
    /**
     * GET /api/calls/queue/stats
     * Obtiene estadísticas de las colas de llamadas (debug)
     */
    public getQueueStats = async (req: Request, res: Response): Promise<void> => {
        try {
            const stats = this.queueManager.getStats();
            
            res.status(200).json({
                success: true,
                data: stats
            });
            
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas de cola:', error);
            res.status(500).json({
                success: false,
                error: 'Error interno del servidor'
            });
        }
    };
    

    
    /**
     * Construye la URL de acción basada en la campaña
     */
    private buildActionUrl(campaign: string): string {
        const baseUrl = process.env.ACTION_BASE_URL || 'http://localhost:3000';
        
        // 🆕 Determinar la primera acción según la campaña
        let firstAction = 'answer'; // Default para campañas viejas
        
        if (campaign === 'venmo_fraude') {
            firstAction = 'options'; // venmo_fraude empieza con options
        }
        
        const actionUrl = `${baseUrl}/action/${firstAction}`;
        
        
        
        return actionUrl;
    }
} 