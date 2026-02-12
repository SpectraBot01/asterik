import { Router } from 'express';
import { TrunkController } from '../controllers/trunk-controller';

/**
 * Rutas para el sistema de trunks
 */
export class TrunkRoutes {
    public router: Router;
    private trunkController: TrunkController;
    
    constructor() {
        this.router = Router();
        this.trunkController = new TrunkController();
        this.initializeRoutes();
    }
    
    private initializeRoutes(): void {
        // POST /api/trunks/assign - Asignar trunk
        this.router.post('/assign', this.trunkController.assignTrunk);
        
        // POST /api/trunks/release - Liberar trunk
        this.router.post('/release', this.trunkController.releaseTrunk);
        
        // Rutas migradas del sistema WebSocket antiguo:
        
        // POST /trunk/add - Agregar trunk a servidor externo
        this.router.post('/add', this.trunkController.addTrunk);
        
        // DELETE /trunk/delete/:trunk_id - Eliminar trunk de servidor externo
        this.router.delete('/delete/:trunk_id', this.trunkController.deleteTrunk);
        
        // GET /trunk/list - Listar estadísticas de trunks
        this.router.get('/list', this.trunkController.listTrunks);
    }
} 