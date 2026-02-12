import { Request, Response } from 'express';
import { TrunkService } from '../../modules/trunks/trunk-service';

/**
 * Controladores para los endpoints de trunks
 */
export class TrunkController {
    private trunkService: TrunkService;
    
    constructor() {
        this.trunkService = TrunkService.getInstance();
    }
    
    /**
     * POST /api/trunks/assign
     * Asigna un trunk disponible para un user_token
     */
    public assignTrunk = async (req: Request, res: Response): Promise<void> => {
        try {
            const { user_token } = req.body;
            
            if (!user_token) {
                res.status(400).json({
                    success: false,
                    error: 'user_token es requerido'
                });
                return;
            }
            
            const result = this.trunkService.assignTrunk(user_token);
            
            if (result.success) {
                res.status(200).json({
                    success: true,
                    assignment_uuid: result.assignment_uuid,
                    trunk_name: result.trunk?.trunk_id || 'unknown'
                });
            } else {
                res.status(404).json({
                    success: false,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('❌ Error en assignTrunk:', error);
            res.status(500).json({
                success: false,
                error: 'Error interno del servidor'
            });
        }
    };
    
    /**
     * POST /api/trunks/release
     * Libera un trunk por assignment_uuid
     */
    public releaseTrunk = async (req: Request, res: Response): Promise<void> => {
        try {
            const { assignment_uuid } = req.body;
            
            if (!assignment_uuid) {
                res.status(400).json({
                    success: false,
                    error: 'assignment_uuid es requerido'
                });
                return;
            }
            
            const result = this.trunkService.releaseAssignment(assignment_uuid);
            
            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: result.message,
                    released_at: new Date().toISOString()
                });
            } else {
                res.status(404).json({
                    success: false,
                    error: result.message
                });
            }
        } catch (error) {
            console.error('❌ Error en releaseTrunk:', error);
            res.status(500).json({
                success: false,
                error: 'Error interno del servidor'
            });
        }
    };
    
    /**
     * POST /trunk/add
     * Agrega un nuevo trunk a un servidor externo
     */
    public addTrunk = async (req: Request, res: Response): Promise<void> => {
        const { ip_server, sip_username, sip_password, sip_server_url, type } = req.body;

        if (!ip_server || !sip_username || !sip_password || !sip_server_url || !type) {
            res.status(400).json({
                success: false,
                message: "Todos los parámetros son requeridos: ip_server, sip_username, sip_password, sip_server_url, type"
            });
            return;
        }

        try {
            // Construir la URL del servidor externo (puerto estándar para trunks)
            const external_url = `http://${ip_server}:56201/add-trunk`;
            
            // Preparar los datos para enviar al servidor externo
            const trunkData = {
                username: sip_username,
                password: sip_password,
                server: sip_server_url,
                type
            };


            // Hacer la petición al servidor externo
            const response = await fetch(external_url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(trunkData),
                signal: AbortSignal.timeout(10000) // Timeout de 10s
            });

            // Obtener la respuesta
            const responseData = await response.json();


            // Devolver la respuesta del servidor externo
            res.status(response.status).json(responseData);

        } catch (error) {
            console.error('❌ Error al agregar trunk:', error);
            res.status(500).json({
                success: false,
                message: "Error al conectar con el servidor del trunk",
                error: error instanceof Error ? error.message : "Error desconocido"
            });
        }
    };

    /**
     * DELETE /trunk/delete/:trunk_id
     * Elimina un trunk de un servidor externo
     */
    public deleteTrunk = async (req: Request, res: Response): Promise<void> => {
        const { trunk_id } = req.params;
        const { ip_server } = req.body;

        if (!trunk_id || !ip_server) {
            res.status(400).json({
                success: false,
                message: "Todos los parámetros son requeridos: trunk_id (en URL) y ip_server (en body)"
            });
            return;
        }

        try {
            // Construir la URL del servidor externo
            const external_url = `http://${ip_server}:56201/delete-trunk/${trunk_id}`;
            

            // Hacer la petición al servidor externo
            const response = await fetch(external_url, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: AbortSignal.timeout(10000) // Timeout de 10s
            });

            // Obtener la respuesta
            const responseData = await response.json();


            // Devolver la respuesta del servidor externo
            res.status(response.status).json(responseData);

        } catch (error) {
            console.error('❌ Error al eliminar trunk:', error);
            res.status(500).json({
                success: false,
                message: "Error al conectar con el servidor del trunk",
                error: error instanceof Error ? error.message : "Error desconocido"
            });
        }
    };

    /**
     * GET /trunk/list
     * Lista estadísticas de trunks disponibles
     */
    public listTrunks = async (req: Request, res: Response): Promise<void> => {
        try {
            // Obtener estadísticas de trunks disponibles
            const stats = this.trunkService.getStats();
            
            res.status(200).json({
                success: true,
                data: stats.usageStats,
                totalTrunks: stats.totalTrunks || 0,
                totalAssigned: stats.totalAssignments || 0,
                totalUsers: stats.totalUsers || 0,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Error listando trunks:', error);
            res.status(500).json({
                success: false,
                error: 'Error interno del servidor'
            });
        }
    };

} 