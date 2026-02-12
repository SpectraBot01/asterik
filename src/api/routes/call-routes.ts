import { Router } from 'express';
import { CallController } from '../controllers/call-controller';

/**
 * Rutas para el sistema de llamadas
 */
export class CallRoutes {
    public router: Router;
    private callController: CallController;
    
    constructor() {
        this.router = Router();
        this.callController = new CallController();
        this.initializeRoutes();
    }
    
    private initializeRoutes(): void {
        // POST /api/calls/create - Crear llamada
        this.router.post('/create', this.callController.createCall);
        
        // POST /api/calls/:id/destroy - Terminar llamada
        this.router.post('/:id/destroy', this.callController.destroyCall);
        
        // GET /api/calls/queue/stats - Estadísticas de cola (debug)
        this.router.get('/queue/stats', this.callController.getQueueStats);
    }
} 