import axios from 'axios';
import { CampaignConfig } from '../../config/campaign-config';

/**
 * Interfaz para los datos de una acción específica
 */
export interface ActionData {
    audio: string;
    next?: string;
    dgts?: number;
    finishOnKey?: string;  // 🆕 Carácter para terminar gather dinámicamente (ej: "#")
    method?: string;
    timeout: number;
}

/**
 * Interfaz para una campaña completa
 */
export interface Campaign {
    [key: string]: ActionData;
}

/**
 * Servicio para manejar campañas IVR
 */
export class CampaignService {
    private static instance: CampaignService;
    private campaignsCache: Map<string, Campaign> = new Map();
    
    /**
     * Singleton pattern
     */
    public static getInstance(): CampaignService {
        if (!CampaignService.instance) {
            CampaignService.instance = new CampaignService();
            // Cargar campañas al inicializar
            setImmediate(() => {
                CampaignService.instance.loadAllCampaigns().catch(error => {
                    console.error('❌ Error cargando campañas:', error);
                });
            });
        }
        return CampaignService.instance;
    }
    
    /**
     * Obtiene una campaña por nombre, primero busca en cache local y luego en el servidor
     */
    public async getCampaign(campaignName: string): Promise<Campaign | null> {
        try {
            // Buscar en cache primero
            if (this.campaignsCache.has(campaignName)) {
                const campaign = this.campaignsCache.get(campaignName)!;
                return campaign;
            }
            
            
            // Cargar desde API si no está en cache
            await this.loadAllCampaigns();
            
            const campaign = this.campaignsCache.get(campaignName);
            
           
            
            return campaign || null;
            
        } catch (error) {
            console.error(`❌ Error obteniendo campaña '${campaignName}':`, error);
            return null;
        }
    }
    
    /**
     * Carga todas las campañas desde la API
     */
    public async loadAllCampaigns(): Promise<void> {
        try {
            
            const response = await axios.get(CampaignConfig.CAMPAIGNS_API_URL, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: CampaignConfig.REQUEST_TIMEOUT_MS
            });
            
            if (response.status === 200 && response.data) {
                const campaigns = response.data;
                
                
                // Limpiar cache y cargar nuevas campañas
                this.campaignsCache.clear();
                
                Object.keys(campaigns).forEach(campaignName => {
                    const actions = Object.keys(campaigns[campaignName]);
                    this.campaignsCache.set(campaignName, campaigns[campaignName]);
                
                });
                
            }
            
        } catch (error) {
            console.error('❌ Error cargando campañas desde la API:', error);
        }
    }
    
    /**
     * Obtiene los datos de una acción específica de una campaña
     */
    public async getActionData(campaignName: string, action: string): Promise<ActionData | null> {
        try {
            const campaign = await this.getCampaign(campaignName);
            
            if (!campaign) {
                return null;
            }
            
            const actionData = campaign[action];
            
            if (!actionData) {
                return null;
            }
            
            return actionData;
            
        } catch (error) {
            console.error(`❌ Error obteniendo datos de acción '${action}' para campaña '${campaignName}':`, error);
            return null;
        }
    }
    
    /**
     * Obtiene todas las campañas en cache (para debug)
     */
    public getAllCachedCampaigns(): Record<string, Campaign> {
        const result: Record<string, Campaign> = {};
        
        this.campaignsCache.forEach((campaign, name) => {
            result[name] = campaign;
        });
        
        return result;
    }
    
    /**
     * Limpia el cache de campañas
     */
    public clearCache(): void {
        this.campaignsCache.clear();
    }
    
    /**
     * Fuerza la recarga de campañas desde la API
     */
    public async reloadCampaigns(): Promise<void> {
        this.clearCache();
        await this.loadAllCampaigns();
    }
    
} 