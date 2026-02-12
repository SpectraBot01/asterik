import { Router } from 'express';
import { ActionController } from '../controllers/action-controller';

/**
 * Rutas para el sistema de acciones IVR
 */
export class ActionRoutes {
    public router: Router;
    private actionController: ActionController;
    
    constructor() {
        this.router = Router();
        this.actionController = new ActionController();
        this.initializeRoutes();
    }
    
    private initializeRoutes(): void {
        // GET /action/:status - Maneja acciones del IVR
        this.router.get('/:status', this.actionController.handleAction);
        
        // Debug routes
        this.router.get('/debug/campaigns', this.actionController.getCampaigns);
        this.router.post('/debug/reload', this.actionController.reloadCampaigns);
    }
} 