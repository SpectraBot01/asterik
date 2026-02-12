import { TrunkStore } from '../../store/trunk-store';
import { TrunkConfig } from '../../config/trunk-config';

/**
 * Servicio de gestión de trunks
 * - Descarga inventario cada 30 segundos
 * - Gestiona asignaciones y liberaciones
 * - Proporciona estadísticas del sistema
 */
export class TrunkService {
    private static instance: TrunkService;
    private trunkStore: TrunkStore;
    private updateInterval: NodeJS.Timeout | null = null;
    
    private constructor() {
        this.trunkStore = TrunkStore.getInstance();
    }
    
    public static getInstance(): TrunkService {
        if (!TrunkService.instance) {
            TrunkService.instance = new TrunkService();
        }
        return TrunkService.instance;
    }
    
    /**
     * Inicializa el servicio de trunks
     */
    public async initialize(): Promise<void> {
        
        // Cargar trunks inicial
        const initialResult = await this.getAllTrunks();

        
        // Configurar auto-actualización
        this.updateInterval = setInterval(async () => {
            const result = await this.getAllTrunks();
        }, TrunkConfig.UPDATE_INTERVAL_MS);
        
    }
    
    /**
     * Detiene el servicio
     */
    public stop(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
    
    /**
     * Descarga todos los trunks desde la API externa
     * Nueva estructura: { success: true, trunks: { user_token: [{ sip_id, sip_phone, sip_verified }] } }
     */
    private async getAllTrunks(): Promise<{ success: boolean; error?: string; totalUsers?: number; totalTrunks?: number }> {
        try {
            const response = await fetch(TrunkConfig.TRUNK_API_URL);
            
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
            
            const data: any = await response.json();
            
            if (data.success && data.trunks) {
                // 🆕 Convertir nueva estructura a formato esperado por updateTrunkInventory
                // De: { user_token: [{ sip_id, sip_phone, sip_verified }] }
                // A: [{ user_token, trunks: [{ trunk_id, phone_number, is_verified, ... }] }]
                const convertedData = this.convertApiResponseToInternalFormat(data.trunks);
                
                // Actualizar store con nuevos datos
                this.trunkStore.updateTrunkInventory(convertedData);
                
                // Calcular estadísticas
                let totalUsers = convertedData.length;
                let totalTrunks = 0;
                
                convertedData.forEach((userGroup: any) => {
                    totalTrunks += userGroup.trunks.length;
                });
                
                return {
                    success: true,
                    totalUsers,
                    totalTrunks
                };
            } else {
                return {
                    success: false,
                    error: 'Respuesta de API inválida'
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Error desconocido'
            };
        }
    }
    
    /**
     * Convierte la nueva estructura de la API al formato interno esperado
     * @param trunks Objeto con user_token como keys y arrays de trunks como valores
     * @returns Array con formato [{ user_token, trunks: [...] }]
     */
    private convertApiResponseToInternalFormat(trunks: Record<string, Array<{ sip_id: string; sip_phone: string; sip_verified: boolean }>>): any[] {
        const result: any[] = [];
        
        Object.keys(trunks).forEach(userToken => {
            const trunkList = trunks[userToken];
            
            // Convertir cada trunk de la nueva estructura a la estructura interna
            // Solo mapear los campos que vienen de la API
            const convertedTrunks = trunkList.map(trunk => ({
                trunk_id: trunk.sip_id,           // sip_id → trunk_id
                phone_number: trunk.sip_phone,     // sip_phone → phone_number
                is_verified: trunk.sip_verified    // sip_verified → is_verified
            }));
            
            result.push({
                user_token: userToken,
                trunks: convertedTrunks
            });
        });
        
        return result;
    }
    
    /**
     * Asigna un trunk para un user_token
     */
    public assignTrunk(userToken: string): { success: boolean; trunk?: any; assignment_uuid?: string; error?: string } {
        if (!userToken) {
            return {
                success: false,
                error: 'user_token es requerido'
            };
        }
        
        return this.trunkStore.assignTrunk(userToken);
    }
    
    /**
     * Libera un trunk por assignment_uuid
     */
    public releaseAssignment(assignmentUuid: string): { success: boolean; message: string } {
        if (!assignmentUuid) {
            return {
                success: false,
                message: 'assignment_uuid es requerido'
            };
        }
        
        return this.trunkStore.releaseAssignment(assignmentUuid);
    }
    
    /**
     * Mantiene viva una asignación (resetea timeout a 2 minutos)
     * Se debe llamar cada vez que se use el assignment_uuid para crear una llamada
     */
    public keepAlive(assignmentUuid: string): { success: boolean; message: string } {
        if (!assignmentUuid) {
            return {
                success: false,
                message: 'assignment_uuid es requerido'
            };
        }
        
        return this.trunkStore.keepAlive(assignmentUuid);
    }
    
    /**
     * Obtiene información de trunk por assignment_uuid
     */
    public getTrunkByAssignment(assignmentUuid: string) {
        if (!assignmentUuid) {
            return null;
        }
        
        return this.trunkStore.getTrunkByAssignment(assignmentUuid);
    }
    
    /**
     * Obtiene estadísticas del sistema
     */
    public getStats() {
        return this.trunkStore.getStats();
    }
    
    /**
     * Obtiene trunks disponibles para un user_token (para debugging)
     */
    public getTrunksForUser(userToken: string) {
        return this.trunkStore.getTrunksForUser(userToken);
    }
} 