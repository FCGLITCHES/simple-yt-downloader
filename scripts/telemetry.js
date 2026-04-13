// Privacy-respectful error telemetry system
// Opt-in only, no personal data collected

class TelemetryService {
    constructor() {
        this.enabled = false;
        this.endpoint = process.env.TELEMETRY_ENDPOINT || 'https://api.example.com/telemetry';
        this.maxQueueSize = 100;
        this.errorQueue = [];
        this.anonymousId = this.getOrCreateAnonymousId();
    }

    getOrCreateAnonymousId() {
        // Generate or retrieve anonymous ID (stored locally, no PII)
        const key = 'simplyytd_anonymous_id';
        let id = localStorage.getItem(key);
        if (!id) {
            id = `anon_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            localStorage.setItem(key, id);
        }
        return id;
    }

    isOptedIn() {
        // Check user preference
        const userSettings = JSON.parse(localStorage.getItem('userSettings') || '{}');
        return userSettings.errorTelemetry === true;
    }

    enable() {
        this.enabled = this.isOptedIn();
        if (this.enabled) {
            this.setupErrorHandlers();
            console.log('✅ Error telemetry enabled (opt-in)');
        }
    }

    disable() {
        this.enabled = false;
        console.log('❌ Error telemetry disabled');
    }

    setupErrorHandlers() {
        // Global error handler
        window.addEventListener('error', (event) => {
            this.captureError({
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack,
                type: 'unhandled_error'
            });
        });

        // Unhandled promise rejection handler
        window.addEventListener('unhandledrejection', (event) => {
            this.captureError({
                message: event.reason?.message || String(event.reason),
                stack: event.reason?.stack,
                type: 'unhandled_promise_rejection'
            });
        });

        // WebSocket error handler (if available)
        if (window.ws) {
            const originalOnError = window.ws.onerror;
            window.ws.onerror = (error) => {
                this.captureError({
                    message: 'WebSocket error',
                    type: 'websocket_error',
                    details: error?.message || String(error)
                });
                if (originalOnError) originalOnError.call(window.ws, error);
            };
        }
    }

    captureError(errorInfo) {
        if (!this.enabled) return;

        const telemetryData = {
            anonymousId: this.anonymousId,
            timestamp: new Date().toISOString(),
            application: {
                name: 'SimplyYTD',
                version: window.SIMPLYYTD_VERSION || '1.0.0'
            },
            error: {
                message: this.sanitize(errorInfo.message),
                type: errorInfo.type || 'unknown',
                filename: errorInfo.filename ? this.sanitizePath(errorInfo.filename) : undefined,
                lineno: errorInfo.lineno,
                colno: errorInfo.colno,
                stack: errorInfo.stack ? this.sanitizeStack(errorInfo.stack) : undefined,
                details: errorInfo.details ? this.sanitize(errorInfo.details) : undefined
            },
            system: {
                platform: navigator.platform,
                userAgent: navigator.userAgent.substring(0, 100) // Limited to prevent fingerprinting
            }
        };

        this.errorQueue.push(telemetryData);

        // Limit queue size
        if (this.errorQueue.length > this.maxQueueSize) {
            this.errorQueue.shift();
        }

        // Send asynchronously (don't block)
        this.sendBatch().catch(() => {
            // Silently fail - don't disrupt user experience
        });
    }

    sanitize(text) {
        if (!text) return '';
        // Remove any potential PII (URLs, file paths, etc.)
        return String(text)
            .replace(/https?:\/\/[^\s]+/g, '[URL_REMOVED]')
            .replace(/[A-Z]:\\[^\s]+/g, '[PATH_REMOVED]')
            .replace(/\/[^\s]+/g, '[PATH_REMOVED]')
            .substring(0, 500); // Limit length
    }

    sanitizePath(path) {
        if (!path) return '';
        // Remove full paths, keep only filename
        return path.split(/[\\/]/).pop() || '[PATH_REMOVED]';
    }

    sanitizeStack(stack) {
        if (!stack) return '';
        // Remove file paths from stack traces
        return stack
            .split('\n')
            .map(line => {
                // Keep only function names and line numbers, remove paths
                return line.replace(/\(.*?\)/g, '(...)')
                    .replace(/at\s+.*?[/\\]/g, 'at ')
                    .substring(0, 200);
            })
            .join('\n')
            .substring(0, 2000);
    }

    async sendBatch() {
        if (this.errorQueue.length === 0 || !this.enabled) return;

        const batch = [...this.errorQueue];
        this.errorQueue = [];

        try {
            // Only send if endpoint is configured and not localhost
            if (!this.endpoint || this.endpoint.includes('localhost') || this.endpoint.includes('127.0.0.1')) {
                console.log('📊 Telemetry batch (not sent - no endpoint configured):', batch);
                return;
            }

            await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    anonymousId: this.anonymousId,
                    errors: batch,
                    batchSize: batch.length
                }),
                // Don't wait for response - fire and forget
                keepalive: true
            });
        } catch (error) {
            // Silently fail - don't disrupt user experience
            // Re-queue errors if send failed (up to limit)
            this.errorQueue = [...batch, ...this.errorQueue].slice(0, this.maxQueueSize);
        }
    }

    // Manual error reporting (for testing or explicit user reports)
    reportError(error, context = {}) {
        this.captureError({
            message: error?.message || String(error),
            stack: error?.stack,
            type: 'manual_report',
            ...context
        });
    }
}

// Export singleton instance
const telemetry = new TelemetryService();

// Initialize if opted in
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        if (telemetry.isOptedIn()) {
            telemetry.enable();
        }
        // Make available globally for manual error reporting
        window.SimplyYTDTelemetry = telemetry;
    });
}

module.exports = { TelemetryService, telemetry };

