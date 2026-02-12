// Exportaciones principales
export { ARIRestClient } from './rest-client';
export { ChannelManager } from './channel-manager';
export { ARIService } from './ari-service';
export { ARIEventHandler } from './event-handler';

// Exportar tipos
export * from './types';

// Exportar configuraciones por defecto
export const DEFAULT_ARI_CONFIG = {
    reconnectTimeout: 5000,
    maxRetries: 3,
    debug: false
};

// Exportar versión
export const ARI_VERSION = '1.0.0'; 