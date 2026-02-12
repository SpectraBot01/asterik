import crypto from 'crypto';
import { TrunkConfig } from '../config/trunk-config';

interface Trunk {
    trunk_id: string;
    phone_number: string;
    is_verified?: boolean;  // Campo para trunks verificados (límite 9 vs 4)
}

interface TrunkAssignment {
    trunk_id: string;
    trunk_data: Trunk;
    assigned_at: Date;
    timeout_id: NodeJS.Timeout;
}

/**
 * Store in-memory para gestión de trunks
 * - Almacena trunks por user_token
 * - Mantiene contadores de uso por trunk_id
 *   * Custom/Telnyx verificados (is_verified: true): límite de 9 usos simultáneos
 *   * Custom/Telnyx NO verificados (is_verified: false): límite de 4 usos simultáneos
 *   * Otros (Twilio, etc.): uso ilimitado
 * - Gestiona asignaciones con TTL de 2 minutos
 */
export class TrunkStore {
    private static instance: TrunkStore;
    
    // Almacenamiento de trunks por user_token
    private trunksByUserToken: Map<string, Trunk[]> = new Map();
    
    // Contador de uso por trunk_id (máximo 4)
    private trunkUsageCount: Map<string, number> = new Map();
    
    // Asignaciones con TTL de 1 minuto
    private assignments: Map<string, TrunkAssignment> = new Map();
    
    private constructor() {}
    
    public static getInstance(): TrunkStore {
        if (!TrunkStore.instance) {
            TrunkStore.instance = new TrunkStore();
        }
        return TrunkStore.instance;
    }
    
    /**
     * Actualiza el inventario de trunks
     */
    public updateTrunkInventory(data: any[]): void {
       
        
        // Limpiar almacenamiento anterior
        this.trunksByUserToken.clear();
        
        // Obtener IDs de trunks actuales
        const currentTrunkIds = new Set<string>();
        
        // 🆕 Crear mapa de trunks por trunk_id para actualizar assignments
        const trunkById = new Map<string, Trunk>();
        
        // Procesar datos y almacenar por user_token
        data.forEach(userGroup => {
            const userToken = userGroup.user_token;
            const normalizedUserToken = userToken.replace(/-/g, ''); // Remover guiones
            const trunks = userGroup.trunks;
            
            this.trunksByUserToken.set(normalizedUserToken, trunks);
            
            // Inicializar contadores para trunks nuevos
            trunks.forEach((trunk: Trunk) => {
                currentTrunkIds.add(trunk.trunk_id);
                trunkById.set(trunk.trunk_id, trunk); // 🆕 Guardar para actualizar assignments
                
                if (!this.trunkUsageCount.has(trunk.trunk_id)) {
                    this.trunkUsageCount.set(trunk.trunk_id, 0);
                }
            });
        });
        
        // 🆕 Actualizar trunk_data en assignments activos
        let assignmentsActualizados = 0;
        this.assignments.forEach((assignment, assignmentUuid) => {
            const nuevoTrunkData = trunkById.get(assignment.trunk_id);
            
            if (nuevoTrunkData) {
                // Actualizar con COPIA de los datos nuevos (no compartir referencia)
                assignment.trunk_data = { ...nuevoTrunkData };
                assignmentsActualizados++;
            } else {
                // El trunk ya no existe en la API → invalidar assignment
                console.warn(`⚠️ Trunk ${assignment.trunk_id} ya no existe en la API. Assignment ${assignmentUuid} invalidado.`);
            }
        });
        

        
        // Limpiar contadores de trunks obsoletos
        const obsoleteTrunks: string[] = [];
        this.trunkUsageCount.forEach((count, trunkId) => {
            if (!currentTrunkIds.has(trunkId)) {
                obsoleteTrunks.push(trunkId);
            }
        });
        
        obsoleteTrunks.forEach(trunkId => {
            this.trunkUsageCount.delete(trunkId);
        });
    }
    
    /**
     * Obtiene trunks disponibles para un user_token
     */
    public getTrunksForUser(userToken: string): Trunk[] {
        const normalizedUserToken = userToken.replace(/-/g, '');
        return this.trunksByUserToken.get(normalizedUserToken) || [];
    }
    
    /**
     * Detecta si un trunk es custom o de Telnyx
     * - trunk_id empieza con "telnyx_" o "custom_"
     */
    private isCustomOrTelnyxTrunk(trunk: Trunk): boolean {
        // Verificar prefijos telnyx_ o custom_
        return trunk.trunk_id.startsWith('telnyx_') || trunk.trunk_id.startsWith('custom_');
    }
    
    /**
     * Obtiene el límite máximo de uso para un trunk según su tipo y verificación
     * - Custom/Telnyx verificado (is_verified: true): límite de 9
     * - Custom/Telnyx NO verificado (is_verified: false): límite de 4
     * - Otros (Twilio, etc.): ilimitado (Infinity)
     */
    private getMaxUsageForTrunk(trunk: Trunk): number {
        if (this.isCustomOrTelnyxTrunk(trunk)) {
            // ✅ Si el trunk está verificado, permitir 9 llamadas simultáneas
            if (trunk.is_verified === true) {
                return 9;
            }
            // ❌ Si NO está verificado (o el campo no existe), usar límite de 4
            return TrunkConfig.MAX_TRUNK_USAGE; // 4 para custom/telnyx no verificados
        }
        return Infinity; // Ilimitado para el resto (Twilio, etc.)
    }
    
    /**
     * Busca un trunk disponible
     * - Custom/Telnyx verificados: verifica que uso < 9
     * - Custom/Telnyx NO verificados: verifica que uso < 4
     * - Otros: siempre disponible (ilimitado)
     */
    public findAvailableTrunk(userToken: string): Trunk | null {
        const trunks = this.getTrunksForUser(userToken);
        
        for (const trunk of trunks) {
            const maxUsage = this.getMaxUsageForTrunk(trunk);
            
            // Si es ilimitado, siempre está disponible
            if (maxUsage === Infinity) {
                return trunk;
            }
            
            // Si tiene límite, verificar que no lo haya alcanzado
            const currentUsage = this.trunkUsageCount.get(trunk.trunk_id) || 0;
            if (currentUsage < maxUsage) {
                return trunk;
            }
        }
        
        return null;
    }
    
    /**
     * Asigna un trunk con TTL de 1 minuto
     */
    public assignTrunk(userToken: string): { success: boolean; trunk?: Trunk; assignment_uuid?: string; error?: string } {
        const availableTrunk = this.findAvailableTrunk(userToken);
        
        if (!availableTrunk) {
            return {
                success: false,
                error: 'No hay trunks disponibles para este user_token'
            };
        }
        
        // Incrementar contador
        const currentUsage = this.trunkUsageCount.get(availableTrunk.trunk_id) || 0;
        this.trunkUsageCount.set(availableTrunk.trunk_id, currentUsage + 1);
        
        // Crear asignación con TTL de 2 minutos
        const assignmentId = this.generateUUID();
        const timeout_id = setTimeout(() => {
            this.releaseAssignmentById(assignmentId);
        }, TrunkConfig.ASSIGNMENT_TTL_MS);
        
        const assignment: TrunkAssignment = {
            trunk_id: availableTrunk.trunk_id,
            trunk_data: { ...availableTrunk }, // Crear copia para evitar referencias compartidas
            assigned_at: new Date(),
            timeout_id
        };
        
        this.assignments.set(assignmentId, assignment);
        
      
        
        return {
            success: true,
            trunk: availableTrunk,
            assignment_uuid: assignmentId
        };
    }
    
    /**
     * Obtiene información de trunk por assignment_uuid
     */
    public getTrunkByAssignment(assignmentUuid: string): TrunkAssignment | null {
        const assignment = this.assignments.get(assignmentUuid);
      
        return assignment || null;
    }
    
    /**
     * Mantiene viva una asignación (resetea el timeout)
     * Se llama cada vez que se usa el assignment_uuid para crear una llamada
     */
    public keepAlive(assignmentUuid: string): { success: boolean; message: string } {
        const assignment = this.assignments.get(assignmentUuid);
        
        if (!assignment) {
            return {
                success: false,
                message: 'Asignación no encontrada'
            };
        }
        
        // Limpiar el timeout anterior
        clearTimeout(assignment.timeout_id);
        
        // Crear nuevo timeout de 2 minutos
        const newTimeoutId = setTimeout(() => {
            this.releaseAssignmentById(assignmentUuid);
        }, TrunkConfig.ASSIGNMENT_TTL_MS);
        
        // Actualizar el timeout en la asignación
        assignment.timeout_id = newTimeoutId;
        assignment.assigned_at = new Date(); // Actualizar timestamp
                
        return {
            success: true,
            message: 'Timeout de asignación renovado por 2 minutos'
        };
    }
    
    /**
     * Libera una asignación por assignment_uuid
     */
    public releaseAssignment(assignmentUuid: string): { success: boolean; message: string } {
        const assignment = this.assignments.get(assignmentUuid);
        
        if (!assignment) {
            return {
                success: false,
                message: 'Asignación no encontrada'
            };
        }
        
        // Limpiar timeout
        clearTimeout(assignment.timeout_id);
        
        // Decrementar contador
        const currentUsage = this.trunkUsageCount.get(assignment.trunk_id) || 0;
        if (currentUsage > 0) {
            this.trunkUsageCount.set(assignment.trunk_id, currentUsage - 1);
        }
        
        // Eliminar asignación
        this.assignments.delete(assignmentUuid);
        
        return {
            success: true,
            message: 'Trunk liberado correctamente'
        };
    }
    
    /**
     * Libera una asignación por ID (método privado para auto-release)
     */
    private releaseAssignmentById(assignmentId: string): { success: boolean; message: string } {
        const assignment = this.assignments.get(assignmentId);
        
        if (!assignment) {
            return {
                success: false,
                message: 'Asignación no encontrada'
            };
        }
        
        // Limpiar timeout
        clearTimeout(assignment.timeout_id);
        
        // Decrementar contador
        const currentUsage = this.trunkUsageCount.get(assignment.trunk_id) || 0;
        if (currentUsage > 0) {
            this.trunkUsageCount.set(assignment.trunk_id, currentUsage - 1);
        }
        
        // Eliminar asignación
        this.assignments.delete(assignmentId);
        
        return {
            success: true,
            message: 'Trunk liberado correctamente'
        };
    }
    
    /**
     * Obtiene estadísticas del sistema
     */
    public getStats() {
        const totalUsers = this.trunksByUserToken.size;
        let totalTrunks = 0;
        let totalAssignments = this.assignments.size;
        
        this.trunksByUserToken.forEach(trunks => {
            totalTrunks += trunks.length;
        });
        
        const usageStats: { [key: string]: number } = {};
        this.trunkUsageCount.forEach((count, trunkId) => {
            if (count > 0) {
                usageStats[trunkId] = count;
            }
        });
        
        return {
            totalUsers,
            totalTrunks,
            totalAssignments,
            usageStats,
            timestamp: new Date().toISOString()
        };
    }
    
    private generateUUID(): string {
        return crypto.randomUUID();
    }
} 