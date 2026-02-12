import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { ServerConfig, PlaybackOptions, ChannelResponse, ActionAttributes, Call } from './types';
import { ARIConfig } from '../../config/ari-config';

export class ARIRestClient {
    appName: string;
    instance: AxiosInstance;
    private serverConfig: ServerConfig;

    constructor(serverConfig: ServerConfig) {
        this.serverConfig = serverConfig;
        
        // Generar app name único y aleatorio para este servidor
        this.appName = this.generateAppName();

        this.instance = axios.create({
            baseURL: `http://${serverConfig.host}:8088/ari`,
            auth: {
                username: serverConfig.username,
                password: serverConfig.password,
            },
            timeout: ARIConfig.CONNECTION_TIMEOUT_MS
        });
        
        this.initializeAxiosInterceptors();
        
    }

    private initializeAxiosInterceptors(): void {
        this.instance.interceptors.response.use(
            response => response,
            async (error: AxiosError) => {
                if (error.response?.status === 401) {
                    console.error('Error de autenticación con Asterisk');
                }
                throw error;
            }
        );
    }

    async createChannel(call: Call, id: string): Promise<any> {
        try {
            const url = `/channels?app=${this.appName}&channelId=${id}&endpoint=PJSIP/${encodeURIComponent(call.to_number)}@${encodeURIComponent(call.trunk)}&callerId=${encodeURIComponent(call.from_number)}&appArgs=${id}`;

            const response = await this.instance.post(url);
            return response.data;
        } catch (error) {
            console.error('Error creando canal:', error);
            throw error;
        }
    }

    async destroyChannel(callId: string): Promise<void> {
        try {
            await this.instance.delete(`/channels/${callId}`);
        } catch (error) {
            throw error;
        }
    }

    async fetchActionXML(url: string, attrib?: ActionAttributes): Promise<string> {
        try {
            const params = new URLSearchParams();
            if (attrib?.Digits) {
                params.append('Digits', attrib.Digits);
            }
            if (attrib?.action) {
                params.append('action', attrib.action);
            }
            
            // Verificar si la URL ya tiene parámetros para usar & en lugar de ?
            const separator = url.includes('?') ? '&' : '?';
            const fullUrl = params.toString() ? `${url}${separator}${params.toString()}` : url;
            const response = await axios.get(fullUrl);
            return response.data;
        } catch (error) {
            console.error('Error fetching action XML:', error);
            throw error;
        }
    }

    async play(channelId: string, options: PlaybackOptions): Promise<any> {
        try {
            const { media, skipMS = 0, playbackId } = options;
            const params = new URLSearchParams({
                media: `sound:${media}`,  // ← CLAVE: Usar prefijo sound: como el ARI original
                skipms: skipMS.toString()
            });
            
            if (playbackId) {
                params.append('playbackId', playbackId);
            }

            const response = await this.instance.post(`/channels/${channelId}/play?${params.toString()}`);
            return response.data;
        } catch (error) {
            console.error('Error playing media:', error);
            throw error;
        }
    }

    async stopPlayback(playbackId: string): Promise<void> {
        try {
            await this.instance.delete(`/playbacks/${playbackId}`);
        } catch (error) {
            console.error('Error stopping playback:', error);
            throw error;
        }
    }

    async continueInDialplan(channelId: string, context?: string, extension?: string, priority?: number): Promise<void> {
        try {
            const params = new URLSearchParams();
            if (context) params.append('context', context);
            if (extension) params.append('extension', extension);
            if (priority) params.append('priority', priority.toString());

            await this.instance.post(`/channels/${channelId}/continue?${params.toString()}`);
        } catch (error) {
            console.error('Error continuing in dialplan:', error);
            throw error;
        }
    }

    async getChannelInfo(channelId: string): Promise<ChannelResponse> {
        try {
            const response = await this.instance.get(`/channels/${channelId}`);
            return response.data;
        } catch (error) {
            console.error('Error getting channel info:', error);
            throw error;
        }
    }

    async hangup(channelId: string, reason?: string): Promise<void> {
        try {
            const params = reason ? `?reason_code=${reason}` : '';
            await this.instance.delete(`/channels/${channelId}${params}`);
        } catch (error: any) {
            // Silenciar 404: canal ya no existe, seguro de ignorar
            const status = error?.response?.status;
            if (status === 404) {
                return;
            }
            // Re-lanzar otros errores sin loguear aquí (serán manejados aguas arriba)
            throw error;
        }
    }

    async answer(channelId: string): Promise<void> {
        try {
            await this.instance.post(`/channels/${channelId}/answer`);
        } catch (error) {
            console.error('Error answering channel:', error);
            throw error;
        }
    }
    
    /**
     * Genera un nombre de aplicación ARI único y aleatorio
     */
    private generateAppName(): string {
        const randomString = Math.random().toString(36).substring(2, 10);
        return `ARI_${randomString}`;
    }
} 