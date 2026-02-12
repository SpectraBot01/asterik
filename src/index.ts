import { UnifiedIVROrchestrator } from './app';

/**
 * Punto de entrada principal
 * 
 * Uso:
 *   node dist/index.js <IP_SERVIDOR_FREEPBX>
 *   o
 *   FREEPBX_IP=192.168.1.100 node dist/index.js
 */
async function main() {
    // Obtener IP del servidor FreePBX desde argumentos o variable de entorno
    const serverIp = process.argv[2] || process.env.FREEPBX_IP;
    
    if (!serverIp) {
        console.error('❌ Error: Debes proporcionar la IP del servidor FreePBX');
        console.error('   Uso: node dist/index.js <IP_SERVIDOR_FREEPBX>');
        console.error('   O: FREEPBX_IP=192.168.1.100 node dist/index.js');
        process.exit(1);
    }
    
    console.log(`🚀 Iniciando servidor con FreePBX en: ${serverIp}`);
    
    const orchestrator = new UnifiedIVROrchestrator();
    
    try {
        // Inicializar servicios con la IP del servidor
        await orchestrator.initialize(serverIp);
        
        // Iniciar servidor
        const port = parseInt(process.env.PORT || '3000');
        orchestrator.start(port);
        
        console.log(`✅ Servidor iniciado en puerto ${port}`);
        console.log(`📡 Conectado a FreePBX: ${serverIp}`);
        
        // Manejar señales de cierre
        process.on('SIGINT', () => {
            orchestrator.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            orchestrator.stop();
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    }
}

// Iniciar aplicación
main().catch(error => {
    console.error('❌ Error iniciando aplicación:', error);
    process.exit(1);
}); 