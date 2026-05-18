// script.js - Frontend logic for GetVideosLocally

// Move these to global scope (before DOMContentLoaded)
let ws;
let clientId = localStorage.getItem('ytdClientId');
let activeDownloader = localStorage.getItem('activeDownloader') || 'youtube';
if (!['youtube', 'history'].includes(activeDownloader)) {
    activeDownloader = 'youtube';
    localStorage.setItem('activeDownloader', activeDownloader);
}
let userSettings;
let downloadItemsState;
let isPowerSaveBlockerActive = false;
const SUPPORT_POPUP_LAST_VERSION_KEY = 'gvl_supportPopupLastShownVersion';
const SUPPORT_DONATION_URL = 'https://donate.stripe.com/6oU00i73R6eh2yc0oU5AQ00';
const LOCAL_THUMBNAIL_PLACEHOLDER = '/assets/thumbnail-placeholder.svg';
const SETUP_HEALTH_RUN_KEY = 'gvlSetupHealthHasRun';

// Make WebSocket globally accessible
window.ws = ws;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize variables
    if (!clientId) {
        clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        localStorage.setItem('ytdClientId', clientId);
    }
    userSettings = loadSettings();
    downloadItemsState = new Map(); // To store item details and manage them
    window.__GVL_ACTIVE_DOWNLOAD_COUNT = 0;

    // Initialize error telemetry (opt-in, privacy-respectful)
    (function () {
        const telemetry = {
            enabled: false,
            anonymousId: (() => {
                const key = 'simplyytd_anonymous_id';
                let id = localStorage.getItem(key);
                if (!id) {
                    id = `anon_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                    localStorage.setItem(key, id);
                }
                return id;
            })(),
            errorQueue: [],
            maxQueueSize: 100,

            enable() {
                this.enabled = true;
                this.setupErrorHandlers();
                console.log('✅ Error telemetry enabled (opt-in)');
            },

            disable() {
                this.enabled = false;
            },

            setupErrorHandlers() {
                window.addEventListener('error', (event) => {
                    if (!this.enabled) return;
                    this.captureError({
                        message: (event.message || '').substring(0, 200),
                        filename: event.filename ? event.filename.split(/[\\/]/).pop() : undefined,
                        lineno: event.lineno,
                        type: 'unhandled_error'
                    });
                });

                window.addEventListener('unhandledrejection', (event) => {
                    if (!this.enabled) return;
                    this.captureError({
                        message: (event.reason?.message || String(event.reason)).substring(0, 200),
                        type: 'unhandled_promise_rejection'
                    });
                });
            },

            captureError(errorInfo) {
                if (!this.enabled) return;
                const telemetryData = {
                    anonymousId: this.anonymousId,
                    timestamp: new Date().toISOString(),
                    error: errorInfo
                };
                this.errorQueue.push(telemetryData);
                if (this.errorQueue.length > this.maxQueueSize) {
                    this.errorQueue.shift();
                }
                // Note: Actual sending would require a configured endpoint
                // For now, errors are queued but not sent unless endpoint is configured
            }
        };

        window.GetVideosLocallyTelemetry = telemetry;
        if (userSettings.errorTelemetry) {
            telemetry.enable();
        }
    })();

    // Make userSettings globally accessible
    window.userSettings = userSettings;
    window.managePowerSaveBlocker = managePowerSaveBlocker;
    window.isPowerSaveBlockerActive = isPowerSaveBlockerActive;

    // DOM Elements - These might not all exist on every page
    const youtubeUrlInput = document.getElementById('youtubeUrl');
    const formatSelect = document.getElementById('format');
    const qualitySelect = document.getElementById('quality'); // For YouTube
    const playlistOptionsDiv = document.getElementById('playlistOptions');
    const playlistActionSelect = document.getElementById('playlistAction');
    const playlistConcurrencySelect = document.getElementById('concurrency');
    const advancedDownloadOptions = document.getElementById('advancedDownloadOptions');
    const scheduleDownloadToggle = document.getElementById('scheduleDownloadToggle');
    const scheduleDownloadAt = document.getElementById('scheduleDownloadAt');
    const startYoutubeDownloadBtn = document.getElementById('startYoutubeDownloadBtn');
    const youtubeStatusDiv = document.getElementById('status');
    const failureHelpPanel = document.getElementById('failureHelpPanel');
    const failureHelpTitle = document.getElementById('failureHelpTitle');
    const failureHelpDescription = document.getElementById('failureHelpDescription');
    const failureHelpSteps = document.getElementById('failureHelpSteps');
    const failureHelpActions = document.getElementById('failureHelpActions');
    const failureHelpPrimaryBtn = document.getElementById('failureHelpPrimaryBtn');
    const dismissFailureHelpBtn = document.getElementById('dismissFailureHelpBtn');
    const youtubeDownloadLinksArea = document.getElementById('downloadLinksArea');
    const emptyDownloadState = document.getElementById('emptyDownloadState');
    const clearYoutubeDownloadsBtn = document.getElementById('clearYoutubeDownloadsBtn');
    const retryFailedDownloadsBtn = document.getElementById('retryFailedDownloadsBtn');

    if (emptyDownloadState) emptyDownloadState.style.display = 'flex';
    if (clearYoutubeDownloadsBtn) clearYoutubeDownloadsBtn.style.display = 'none';
    const networkBanner = document.getElementById('networkBanner');
    const appLiveRegion = document.getElementById('appLiveRegion');

    const youtubeTab = document.getElementById('youtubeTab');
    const contactUsTab = document.querySelector('nav.main-nav a[href="contact.html"]');
    const historyTab = document.getElementById('historyTab');

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const setupHealthSection = document.getElementById('setupHealthSection');
    const setupHealthSummary = document.getElementById('setupHealthSummary');
    const setupHealthTimestamp = document.getElementById('setupHealthTimestamp');
    const setupHealthList = document.getElementById('setupHealthList');
    const runHealthCheckBtn = document.getElementById('runHealthCheckBtn');
    const toggleHealthCheckBtn = document.getElementById('toggleHealthCheckBtn');
    const supportModal = document.getElementById('supportModal');
    const closeSupportModalBtn = document.getElementById('closeSupportModalBtn');
    const supportModalDonateBtn = document.getElementById('supportModalDonateBtn');
    const supportModalDismissBtn = document.getElementById('supportModalDismissBtn');
    const supportModalNeverBtn = document.getElementById('supportModalNeverBtn');
    const playlistSelectionModal = document.getElementById('playlistSelectionModal');
    const closePlaylistSelectionBtn = document.getElementById('closePlaylistSelectionBtn');
    const playlistSelectionSummary = document.getElementById('playlistSelectionSummary');
    const playlistSelectionList = document.getElementById('playlistSelectionList');
    const playlistSelectAllBtn = document.getElementById('playlistSelectAllBtn');
    const playlistClearSelectionBtn = document.getElementById('playlistClearSelectionBtn');
    const confirmPlaylistSelectionBtn = document.getElementById('confirmPlaylistSelectionBtn');
    const cancelPlaylistSelectionBtn = document.getElementById('cancelPlaylistSelectionBtn');

    const maxSpeedInput = document.getElementById('maxSpeed');
    const numerateFilesCheckbox = document.getElementById('numerateFiles');
    const skipDuplicatesCheckbox = document.getElementById('skipDuplicates');
    const removeCompletedCheckbox = document.getElementById('removeCompleted');
    const notificationSoundCheckbox = document.getElementById('notificationSound');
    const notificationPopupCheckbox = document.getElementById('notificationPopup');
    const keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
const subtitleModeSelect = document.getElementById('subtitleMode');
    const subtitleLanguagesInput = document.getElementById('subtitleLanguages');
const includeAutoCaptionsCheckbox = document.getElementById('includeAutoCaptions');
    const speedUnitDisplaySelect = document.getElementById('speedUnitDisplay');
    const resetSpeedBtn = document.getElementById('resetSpeedBtn');
    const downloadFolderInput = document.getElementById('downloadFolder');
    const chooseFolderBtn = document.getElementById('chooseFolderBtn');
    const defaultFolderBtn = document.getElementById('defaultFolderBtn');
    const openFolderBtn = document.getElementById('openFolderBtn');
    const skipDeleteConfirmationCheckbox = document.getElementById('skipDeleteConfirmation');
    const themePresetSelect = document.getElementById('themePreset');

    const completionSound = document.getElementById('completionSound');

    const pasteYoutubeUrlBtn = document.getElementById('pasteYoutubeUrlBtn');
    let failureHelpActionHandler = null;
    let latestSetupHealthResult = null;
    let lastRateLimitNoticeAt = 0;
    const previewInfoCache = new Map();
    const pendingPreviewRequests = new Map();
    const PREVIEW_INFO_CACHE_TTL = 5 * 60 * 1000;
    let pendingPlaylistSelectionRequest = null;

    const importCookiesBtn = document.getElementById('importCookiesBtn');
    if (importCookiesBtn) {
        importCookiesBtn.onclick = () => {
            if (window.electronAPI && window.electronAPI.openCookiesHelper) {
                window.electronAPI.openCookiesHelper();
            } else {
                window.open('public/cookies.html', 'ImportCookies', 'width=600,height=500');
            }
        };
    }

    function getDownloadFolder() {
        // Always use the saved settings as the source of truth
        // This ensures downloads go to the folder specified in settings, not just what's in the DOM
        return userSettings?.downloadFolder || '';
    }

    function setElementHiddenState(element, hidden) {
        if (!element) return;
        element.classList.toggle('is-hidden-initial', hidden);
    }

    function setSetupHealthSectionVisibility(visible) {
        if (!setupHealthSection) return;
        setElementHiddenState(setupHealthSection, !visible);
        setupHealthSection.hidden = !visible;
        setupHealthSection.style.display = visible ? 'flex' : 'none';
        if (toggleHealthCheckBtn) {
            toggleHealthCheckBtn.checked = visible;
        }
    }

    function announceLiveMessage(message) {
        if (!appLiveRegion || !message) return;
        appLiveRegion.textContent = '';
        window.clearTimeout(announceLiveMessage._timer);
        announceLiveMessage._timer = window.setTimeout(() => {
            appLiveRegion.textContent = message;
        }, 20);
    }

    function makeElementKeyboardClickable(element, onActivate, label) {
        if (!element || typeof onActivate !== 'function') return;
        element.setAttribute('role', 'button');
        element.setAttribute('tabindex', '0');
        if (label) {
            element.setAttribute('aria-label', label);
        }
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActivate(event);
            }
        });
    }

    function updateNetworkUI(options = {}) {
        const isOffline = navigator.onLine === false;
        const shouldAnnounce = options.announce === true;

        if (networkBanner) {
            networkBanner.hidden = !isOffline;
        }

        if (startYoutubeDownloadBtn) {
            startYoutubeDownloadBtn.disabled = isOffline;
            startYoutubeDownloadBtn.setAttribute('aria-disabled', String(isOffline));
            startYoutubeDownloadBtn.title = isOffline
                ? 'Reconnect to start downloads'
                : 'Start download';
        }

        if (isOffline) {
            const offlineMessage = 'You appear to be offline. Reconnect to fetch video info or start downloads.';
            if (shouldAnnounce) {
                showStatus(offlineMessage, 'youtube', 'error');
            }
            return;
        }

        if (shouldAnnounce) {
            showStatus('Connection restored. Downloads are available again.', 'youtube', 'success');
        }
    }

    function normalizePreviewUrl(url) {
        return typeof url === 'string' ? url.trim() : '';
    }

    function isPreviewableUrl(url) {
        return /^https?:\/\/.+/i.test(url);
    }

    function isLikelyPlaylistUrl(url) {
        return url.includes('list=') || url.includes('/playlist') || url.includes('/videos') || url.includes('/channel/') || url.includes('/user/');
    }

    function getCachedPreviewInfo(url) {
        const normalizedUrl = normalizePreviewUrl(url);
        const cachedEntry = previewInfoCache.get(normalizedUrl);
        if (!cachedEntry) {
            return null;
        }

        if (Date.now() - cachedEntry.timestamp >= PREVIEW_INFO_CACHE_TTL) {
            previewInfoCache.delete(normalizedUrl);
            return null;
        }

        return cachedEntry.data;
    }

    function setCachedPreviewInfo(url, previewInfo) {
        const normalizedUrl = normalizePreviewUrl(url);
        if (!normalizedUrl || !previewInfo) {
            return;
        }

        previewInfoCache.set(normalizedUrl, {
            data: previewInfo,
            timestamp: Date.now()
        });
    }

    function scheduleYoutubePreview(options = {}) {
        if (!youtubeUrlInput) {
            return;
        }

        const { immediate = false, showErrors = false, forceRefresh = false } = options;
        const normalizedUrl = normalizePreviewUrl(youtubeUrlInput.value);

        window.clearTimeout(scheduleYoutubePreview._timer);
        if (!normalizedUrl || !isPreviewableUrl(normalizedUrl) || isLikelyPlaylistUrl(normalizedUrl) || navigator.onLine === false) {
            return;
        }

        if (!forceRefresh && getCachedPreviewInfo(normalizedUrl)) {
            return;
        }

        const runPreviewFetch = () => {
            fetchVideoInfo(normalizedUrl, 'youtube', {
                showErrors,
                forceRefresh
            }).catch((error) => {
                console.warn('Preview fetch failed:', error);
            });
        };

        if (immediate) {
            runPreviewFetch();
            return;
        }

        scheduleYoutubePreview._timer = window.setTimeout(runPreviewFetch, 350);
    }

    function isPotentialRateLimitMessage(message) {
        const normalizedMessage = String(message || '').toLowerCase();
        return normalizedMessage.includes('rate limiting detected')
            || normalizedMessage.includes('rate-limited')
            || normalizedMessage.includes('too many requests')
            || normalizedMessage.includes('429');
    }

    function showPotentialRateLimitNotice(message) {
        const warningMessage = message || 'Potential rate limiting detected. The app is slowing requests to avoid restrictions. Wait a bit before retrying repeatedly.';
        showStatus(warningMessage, 'youtube', 'warning');

        const now = Date.now();
        if (now - lastRateLimitNoticeAt < 15000) {
            return;
        }

        lastRateLimitNoticeAt = now;
        showNotification('Potential rate limiting detected. Downloads may start more slowly for a short time.', 'warning');
    }

    function openSettingsWithSection(sectionElement) {
        populateSettingsModal();
        if (sectionElement) {
            if (sectionElement === setupHealthSection) {
                setSetupHealthSectionVisibility(true);
            } else {
                setElementHiddenState(sectionElement, false);
            }
        }
        if (settingsModal) {
            openModalWithFocus(settingsModal, closeSettingsBtn || saveSettingsBtn);
        }
        if (sectionElement) {
            window.setTimeout(() => {
                sectionElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 60);
        }
    }

    async function openCookiesHelperFlow() {
        if (window.electronAPI && window.electronAPI.openCookiesHelper) {
            await window.electronAPI.openCookiesHelper();
            return;
        }
        window.open('public/cookies.html', 'ImportCookies', 'width=600,height=500');
    }

    async function getSavedCookiesInfo() {
        if (!window.electronAPI || !window.electronAPI.getCookiesTxt) {
            return {
                available: false,
                hasCookies: false,
                content: '',
                path: ''
            };
        }

        try {
            const result = await window.electronAPI.getCookiesTxt();
            const content = String(result?.content || '').trim();
            return {
                available: true,
                hasCookies: Boolean(result?.success && content.length > 50),
                content,
                path: result?.path || ''
            };
        } catch (error) {
            console.error('Unable to read saved cookies:', error);
            return {
                available: true,
                hasCookies: false,
                content: '',
                path: ''
            };
        }
    }

    async function openConfiguredDownloadFolder() {
        const folderPath = getDownloadFolder() || downloadFolderInput?.value || localStorage.getItem('downloadFolder') || '';
        if (!folderPath) {
            showAlert('No download folder is configured yet.', 'Download Folder');
            return;
        }
        if (window.electronAPI && window.electronAPI.openPathInExplorer) {
            await window.electronAPI.openPathInExplorer(folderPath, folderPath);
            return;
        }
        showAlert('Open folder is only available in the desktop app.', 'Not Available');
    }

    function hideFailureHelp() {
        setElementHiddenState(failureHelpPanel, true);
        if (failureHelpTitle) {
            failureHelpTitle.textContent = 'We found a likely cause';
        }
        if (failureHelpDescription) {
            failureHelpDescription.textContent = '';
        }
        if (failureHelpSteps) {
            failureHelpSteps.innerHTML = '';
        }
        if (failureHelpPrimaryBtn) {
            failureHelpPrimaryBtn.textContent = '';
        }
        failureHelpActionHandler = null;
        setElementHiddenState(failureHelpActions, true);
    }

    function buildFailureHelpConfig(errorMessage) {
        const normalizedMessage = String(errorMessage || '').toLowerCase();

        const configs = [
            {
                id: 'private_video',
                pattern: /(private|members-only|subscriber-only|login required|sign in to confirm|age-restricted)/i,
                title: 'This video likely needs account access.',
                description: 'The source is rejecting anonymous access for this item.',
                steps: [
                    'Make sure the account you use can actually view the video in the browser.',
                    'Import fresh browser cookies if the site requires sign-in, age checks, or membership.',
                    'Retry after importing cookies so yt-dlp can reuse that session.'
                ],
                actionLabel: 'Import Cookies',
                action: () => openCookiesHelperFlow()
            },
            {
                id: 'geo_block',
                pattern: /(not available in your country|not available in your region|geo|region-locked|region blocked)/i,
                title: 'This looks region-blocked.',
                description: 'The site appears to be restricting playback in your current country or region.',
                steps: [
                    'Verify that the video opens normally in your browser from the same machine.',
                    'Use cookies from an account that is allowed to watch the video in that region.',
                    'Retry only after the source itself is accessible; the app cannot bypass geo restrictions.'
                ]
            },
            {
                id: 'rate_limit',
                pattern: /(429|too many requests|rate limit|rate-limit|rate limited|try again later)/i,
                title: 'The source is rate-limiting requests.',
                description: 'You have likely hit a temporary request limit from the site.',
                steps: [
                    'Wait a bit before retrying, especially after several quick attempts.',
                    'Avoid re-fetching the same URL repeatedly in a short burst.',
                    'If the source works better when logged in, import cookies before trying again.'
                ],
                actionLabel: 'Import Cookies',
                action: () => openCookiesHelperFlow()
            },
            {
                id: 'cookies_required',
                pattern: /(cookie|cookies|authentication required|forbidden|http error 403|403 forbidden)/i,
                title: 'This download likely needs cookies.',
                description: 'The source is probably asking for a logged-in browser session.',
                steps: [
                    'Open the cookies helper and import fresh cookies from the browser that can play the video.',
                    'Use cookies from the exact site account that has access to this media.',
                    'Retry after importing to let yt-dlp authenticate with that session.'
                ],
                actionLabel: 'Import Cookies',
                action: () => openCookiesHelperFlow()
            },
            {
                id: 'site_unsupported',
                pattern: /(unsupported url|unsupported site|no suitable extractor|unsupported webpage|extractorerror)/i,
                title: 'This site or URL format may not be supported yet.',
                description: 'yt-dlp may not recognize this page, or support may be outdated.',
                steps: [
                    'Double-check that the URL opens to a playable video page in your browser.',
                    'Update yt-dlp and try again in case support was added recently.',
                    'If it still fails, generate diagnostics so you can report the exact extractor error.'
                ],
                actionLabel: 'Update Tools',
                action: () => {
                    openSettingsWithSection(setupHealthSection);
                    setSetupHealthSectionVisibility(true);
                    const updateToolsBtn = document.getElementById('updateToolsBtn');
                    updateToolsBtn?.click();
                }
            }
        ];

        const matchedConfig = configs.find((config) => config.pattern.test(normalizedMessage));
        if (matchedConfig) {
            return matchedConfig;
        }

        return {
            id: 'generic',
            title: 'This looks like a common extractor or setup failure.',
            description: 'The source returned an error, but the wording does not map to a single known category.',
            steps: [
                'Retry once in case the source returned a temporary response.',
                'Run the setup health check to confirm yt-dlp, FFmpeg, cookies, and folder access look healthy.',
                'If it keeps failing, generate diagnostics so the exact error can be reviewed.'
            ],
            actionLabel: 'Generate Diagnostics',
            action: () => {
                openSettingsWithSection(setupHealthSection);
                setSetupHealthSectionVisibility(true);
                const generateDiagnosticsBtn = document.getElementById('generateDiagnosticsBtn');
                generateDiagnosticsBtn?.click();
            }
        };
    }

    function showFailureHelp(errorMessage) {
        if (!failureHelpPanel || !errorMessage) return;
        const config = buildFailureHelpConfig(errorMessage);

        if (failureHelpTitle) {
            failureHelpTitle.textContent = config.title;
        }
        if (failureHelpDescription) {
            failureHelpDescription.textContent = config.description;
        }
        if (failureHelpSteps) {
            failureHelpSteps.innerHTML = '';
            config.steps.forEach((step) => {
                const listItem = document.createElement('li');
                listItem.textContent = step;
                failureHelpSteps.appendChild(listItem);
            });
        }

        if (failureHelpPrimaryBtn && config.actionLabel && typeof config.action === 'function') {
            failureHelpPrimaryBtn.innerHTML = `<i class="fas fa-arrow-right"></i> ${config.actionLabel}`;
            failureHelpActionHandler = config.action;
            setElementHiddenState(failureHelpActions, false);
        } else {
            failureHelpActionHandler = null;
            setElementHiddenState(failureHelpActions, true);
        }

        setElementHiddenState(failureHelpPanel, false);
    }

    function getHealthStateLabel(state) {
        if (state === 'pass') return 'Ready';
        if (state === 'warn') return 'Needs attention';
        if (state === 'fail') return 'Blocked';
        return 'Checking';
    }

    function formatHealthTimestamp(isoValue) {
        if (!isoValue) return '';
        try {
            return new Date(isoValue).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short'
            });
        } catch (_) {
            return '';
        }
    }

    function renderSetupHealthList(result) {
        if (!setupHealthSummary || !setupHealthList || !setupHealthTimestamp) return;
        setupHealthSummary.textContent = result.summary;
        setupHealthTimestamp.textContent = result.checkedAt
            ? `Last checked: ${formatHealthTimestamp(result.checkedAt)}`
            : '';
        setupHealthList.innerHTML = '';

        result.items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'setup-health-item';

            const heading = document.createElement('div');
            heading.className = 'setup-health-item-heading';

            const label = document.createElement('span');
            label.className = 'setup-health-item-label';
            label.textContent = item.label;

            const badge = document.createElement('span');
            badge.className = `setup-health-state-pill state-${item.state}`;
            badge.textContent = getHealthStateLabel(item.state);

            heading.append(label, badge);

            const detail = document.createElement('p');
            detail.className = 'setup-health-item-detail';
            detail.textContent = item.detail;

            row.append(heading, detail);
            setupHealthList.appendChild(row);
        });
    }

    function renderSetupHealthResult(result) {
        latestSetupHealthResult = result;
        renderSetupHealthList(result);
    }

    function renderSetupHealthLoading(message = 'Checking your local setup...') {
        const loadingResult = {
            summary: message,
            checkedAt: '',
            items: [
                { label: 'Network', state: 'checking', detail: 'Checking connection status...' },
                { label: 'yt-dlp', state: 'checking', detail: 'Checking local yt-dlp installation...' },
                { label: 'FFmpeg', state: 'checking', detail: 'Checking local FFmpeg installation...' },
                { label: 'Cookies helper', state: 'checking', detail: 'Checking cookies helper availability...' },
                { label: 'Download folder', state: 'checking', detail: 'Checking folder access and permissions...' }
            ]
        };
        renderSetupHealthResult(loadingResult);
    }

    async function getResolvedDownloadFolderPath() {
        const configuredFolder = getDownloadFolder() || downloadFolderInput?.value || localStorage.getItem('downloadFolder') || '';
        if (configuredFolder) {
            return configuredFolder;
        }
        if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
            try {
                return await window.electronAPI.getDefaultDownloadFolder();
            } catch (error) {
                console.error('Failed to resolve default download folder for health check:', error);
            }
        }
        return '';
    }

    function getToolHealthItem(label, toolInfo, unavailableMessage) {
        const version = toolInfo?.version;
        const versionText = String(version || '').trim();
        const missingVersion = !versionText || /not found|missing|unknown|n\/a|error/i.test(versionText);

        if (missingVersion) {
            return {
                label,
                state: 'fail',
                detail: unavailableMessage
            };
        }

        return {
            label,
            state: 'pass',
            detail: `Detected ${versionText}`
        };
    }

    async function runSetupHealthCheck(options = {}) {
        const announce = options.announce === true;

        renderSetupHealthLoading(options.loadingMessage);

        const folderPath = await getResolvedDownloadFolderPath();
        const isOnline = navigator.onLine !== false;

        let toolsStatus = null;
        try {
            toolsStatus = await window.checkToolsStatus();
        } catch (error) {
            console.error('Setup health check could not read tool status:', error);
        }

        const cookiesData = await getSavedCookiesInfo();

        let folderExists = false;
        let folderAccess = null;
        try {
            if (folderPath && window.electronAPI && window.electronAPI.pathExists) {
                folderExists = await window.electronAPI.pathExists(folderPath);
            }
            if (folderExists && window.electronAPI && window.electronAPI.testFolderAccess) {
                folderAccess = await window.electronAPI.testFolderAccess(folderPath);
            }
        } catch (error) {
            console.error('Setup health check could not verify folder access:', error);
        }

        const items = [];
        items.push({
            label: 'Network',
            state: isOnline ? 'pass' : 'fail',
            detail: isOnline
                ? 'Internet connection looks available.'
                : 'No internet connection detected. Fetching video info and downloads will stay disabled.'
        });

        if (!toolsStatus) {
            items.push({
                label: 'yt-dlp',
                state: 'warn',
                detail: 'Could not query the local tool service for yt-dlp.'
            });
            items.push({
                label: 'FFmpeg',
                state: 'warn',
                detail: 'Could not query the local tool service for FFmpeg.'
            });
        } else {
            items.push(getToolHealthItem('yt-dlp', toolsStatus.ytdlp, 'yt-dlp is missing or not responding.'));
            items.push(getToolHealthItem('FFmpeg', toolsStatus.ffmpeg, 'FFmpeg is missing or not responding.'));
        }

        if (!window.electronAPI || !window.electronAPI.openCookiesHelper) {
            items.push({
                label: 'Cookies helper',
                state: 'fail',
                detail: 'Cookies helper is unavailable in this environment.'
            });
        } else if (cookiesData.hasCookies) {
            items.push({
                label: 'Cookies helper',
                state: 'pass',
                detail: 'Your own cookies.txt is already imported and ready for restricted sites.'
            });
        } else {
            items.push({
                label: 'Cookies helper',
                state: 'warn',
                detail: 'No personal cookies.txt imported yet. Import your own cookies only if a site requires sign-in, age checks, or account access.'
            });
        }

        if (!folderPath) {
            items.push({
                label: 'Download folder',
                state: 'fail',
                detail: 'No download folder is configured yet.'
            });
        } else if (!folderExists) {
            items.push({
                label: 'Download folder',
                state: 'fail',
                detail: 'The selected download folder does not exist.'
            });
        } else if (folderAccess?.success) {
            items.push({
                label: 'Download folder',
                state: 'pass',
                detail: 'Folder exists and is writable.'
            });
        } else if (folderAccess?.error) {
            items.push({
                label: 'Download folder',
                state: 'fail',
                detail: `Folder access failed: ${folderAccess.error}`
            });
        } else {
            items.push({
                label: 'Download folder',
                state: 'warn',
                detail: 'Folder exists, but write access could not be fully verified here.'
            });
        }

        const blockingCount = items.filter((item) => item.state === 'fail').length;
        const warningCount = items.filter((item) => item.state === 'warn').length;
        const summary = blockingCount === 0 && warningCount === 0
            ? 'Setup looks ready. yt-dlp, FFmpeg, cookies helper, folder access, and network all checked out.'
            : `Setup check found ${blockingCount} blocking issue${blockingCount === 1 ? '' : 's'} and ${warningCount} warning${warningCount === 1 ? '' : 's'}.`;

        const result = {
            summary,
            checkedAt: new Date().toISOString(),
            items
        };

        localStorage.setItem(SETUP_HEALTH_RUN_KEY, 'true');
        renderSetupHealthResult(result);

        if (announce) {
            announceLiveMessage(summary);
        }

        return result;
    }

    let lastFocusedElement = null;

    function getFocusableElements(container) {
        if (!container) return [];
        return Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
    }

    function openModalWithFocus(modal, preferredFocusElement) {
        if (!modal) return;
        lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        const focusTarget = preferredFocusElement || getFocusableElements(modal)[0];
        window.setTimeout(() => {
            focusTarget?.focus();
        }, 0);
    }

    function closeModalWithFocusRestore(modal) {
        if (!modal) return;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        if (lastFocusedElement && lastFocusedElement.isConnected) {
            lastFocusedElement.focus();
        }
    }

    // --- WebSocket Connection ---
    // Only connect WebSocket if on index.html (where download functionality is)
    if (document.getElementById('youtubeDownloader')) {
        updateNetworkUI();
        connectWebSocket();
    }

    window.addEventListener('online', () => {
        updateNetworkUI({ announce: true });
        if (latestSetupHealthResult || !localStorage.getItem(SETUP_HEALTH_RUN_KEY)) {
            void runSetupHealthCheck();
        }
    });
    window.addEventListener('offline', () => {
        updateNetworkUI({ announce: true });
        if (latestSetupHealthResult || !localStorage.getItem(SETUP_HEALTH_RUN_KEY)) {
            void runSetupHealthCheck();
        }
    });
    window.addEventListener('focus', () => {
        if (latestSetupHealthResult && setupHealthSection && !setupHealthSection.classList.contains('is-hidden-initial')) {
            void runSetupHealthCheck();
        }
    });

    async function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const baseWsUrl = `${wsProtocol}//${window.location.hostname}:${window.location.port}?clientId=${encodeURIComponent(clientId)}`;
        const wsUrl = window.localApiAuth && typeof window.localApiAuth.buildWebSocketUrl === 'function'
            ? await window.localApiAuth.buildWebSocketUrl(baseWsUrl)
            : baseWsUrl;
        console.log(`Attempting to connect to WebSocket: ${wsUrl}`);

        ws = new WebSocket(wsUrl);
        window.ws = ws; // Make it globally accessible

        ws.onopen = () => {
            console.log('WebSocket connection established.');
            if (youtubeStatusDiv) showStatus('Connected to server.', 'youtube', 'success');

            const connectionIndicators = document.querySelectorAll('.connection-status');
            connectionIndicators.forEach(indicator => {
                indicator.textContent = 'Connected';
                indicator.className = 'connection-status connected';
            });

            const autoUpdateEnabled = true;
            sendMessageToServer('auto_update_preference', { enabled: autoUpdateEnabled });
            console.log(`Sent auto-update preference to server: ${autoUpdateEnabled ? 'enabled' : 'disabled'}`);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message received:', data);

                // Handle ready message specifically
                if (data.type === 'ready') {
                    console.log('Server ready message received');
                    const currentStatusDiv = youtubeStatusDiv;
                    if (currentStatusDiv) {
                        showStatus('Server ready - you can start downloading!', 'youtube', 'success');
                    }
                    return;
                }

                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                const currentStatusDiv = youtubeStatusDiv;
                if (currentStatusDiv) {
                    showStatus('Error processing message from server.', 'youtube', 'error');
                }
            }
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed. Attempting to reconnect...');
            if (youtubeStatusDiv) showStatus('Disconnected. Attempting to reconnect...', 'youtube', 'error');
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (youtubeStatusDiv) showStatus('WebSocket connection error.', 'youtube', 'error');
        };
    }

    function sendMessageToServer(type, payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({ type, ...payload });
            ws.send(message);
            console.log('WebSocket message sent:', message);
        } else {
            console.error('WebSocket is not connected.');
            const currentStatusDiv = youtubeStatusDiv;
            if (currentStatusDiv) {
                showStatus('Not connected to server. Please wait.', 'youtube', 'error');
            }
        }
    }

    // --- Message Handling ---
    function handleWebSocketMessage(data) {
        const { type, message, itemId, downloadUrl, filename, title, actualSize, percent, rawSpeed, speedBytesPerSec, source = activeDownloader, isPlaylistItem, playlistIndex, playlistId, playlistTitle, thumbnail, fullPath, format, quality } = data;
        const currentItemState = downloadItemsState.get(itemId);

        // Hide playlist meta items (e.g., 'Fetching playlist: ...')
        if (type === 'queued' && title && title.startsWith('Fetching playlist:')) {
            return;
        }

        const linksArea = getLinksArea(source);
        // Only process download-specific UI updates if the linksArea for that source exists
        if (!linksArea && ['queued', 'item_info', 'progress', 'complete', 'error', 'cancel_confirm'].includes(type)) {
            console.warn(`Download links area for source "${source}" not found on this page. Skipping UI update for item ${itemId}, type ${type}.`);
            return;
        }

        switch (type) {
            case 'queued':
                createDownloadItemStructure(itemId, title || 'Processing...', source, isPlaylistItem);
                if (format) {
                    updateDownloadItemFormat(itemId, format, source);
                }
                if (quality) {
                    updateDownloadItemQuality(itemId, quality, source);
                }
                if (thumbnail) {
                    updateDownloadItemThumbnail(itemId, thumbnail);
                }
                updateDownloadItemStatus(itemId, message || 'Queued...', source);
                // Show pause/play button and remove button immediately for queued items
                const queuedItemDiv = document.getElementById(`item-${itemId}`);
                if (queuedItemDiv) {
                    const pausePlayBtn = queuedItemDiv.querySelector('.item-pause-play-btn');
                    const removeBtn = queuedItemDiv.querySelector('.item-remove-btn');
                    if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                    if (removeBtn) removeBtn.style.display = 'inline-flex';
                }
                const queuedItemState = downloadItemsState.get(itemId);
                if (queuedItemState) {
                    queuedItemState.status = 'queued';
                    if (format) queuedItemState.format = format;
                    if (quality) queuedItemState.quality = quality;
                    if (thumbnail) queuedItemState.thumbnail = thumbnail;
                }
                updateDownloadStats();
                break;
            case 'item_info':
                if (!downloadItemsState.has(itemId)) {
                    createDownloadItemStructure(itemId, title || 'Fetching info...', source, isPlaylistItem);
                    // Show pause/play button and remove button for new items
                    const newItemDiv = document.getElementById(`item-${itemId}`);
                    if (newItemDiv) {
                        const pausePlayBtn = newItemDiv.querySelector('.item-pause-play-btn');
                        const removeBtn = newItemDiv.querySelector('.item-remove-btn');
                        if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                        if (removeBtn) removeBtn.style.display = 'inline-flex';
                    }
                }
                updateDownloadItemTitle(itemId, title, source);
                if (format) {
                    updateDownloadItemFormat(itemId, format, source);
                }
                if (quality) {
                    updateDownloadItemQuality(itemId, quality, source);
                }
                if (thumbnail) updateDownloadItemThumbnail(itemId, thumbnail);
                if (currentItemState) {
                    currentItemState.title = title;
                    if (thumbnail) currentItemState.thumbnail = thumbnail;
                    if (fullPath) currentItemState.fullPath = fullPath;
                    if (format) currentItemState.format = format;
                    if (quality) currentItemState.quality = quality;
                }
                break;
            case 'progress':
                updateDownloadItemProgress(itemId, message, percent, rawSpeed, source, speedBytesPerSec);
                if (currentItemState) currentItemState.status = 'downloading';
                updateDownloadStats();
                break;
            case 'complete':
                // Use clean title from server if available, otherwise fall back to filename or title
                const displayTitle = data.title || title || filename || 'Download complete';
                updateDownloadItemComplete(itemId, message, downloadUrl, filename, actualSize, source, fullPath, thumbnail, displayTitle);
                if (userSettings.notificationSound && completionSound) playNotificationSound();
                // Only show notification if user is not on video tab or window is not focused
                const isOnVideoTab = activeDownloader === 'youtube';
                const isWindowFocused = document.hasFocus();
                if (userSettings.notificationPopup && !(isOnVideoTab && isWindowFocused)) {
                    showDesktopNotification(displayTitle, message || 'Download complete!');
                }
                showSupportPopupIfEligible();
                if (userSettings.removeCompleted) {
                    setTimeout(() => handleRemoveDownloadItem(itemId, source), 5000);
                }
                if (currentItemState) currentItemState.status = 'complete';
                // Fix playlist categorization
                let subtabKey = source;
                if (source === 'youtube') {
                    if (currentItemState && currentItemState.isPlaylist) {
                        subtabKey = 'youtubePlaylists';
                    } else {
                        subtabKey = 'youtubeSingles';
                    }
                }
                scanDownloadFolderAndUpdateHistory();
                const history = readStoredHistory();

                // Build history item with playlist info for folder grouping
                const historyItem = {
                    name: displayTitle || filename,
                    path: downloadUrl,
                    fullPath: fullPath || null,  // Absolute path from server for reliable file location
                    folder: data.downloadFolder || getDownloadFolder(),
                    type: subtabKey === 'youtube' ? 'youtubeSingles' : subtabKey,
                    size: actualSize || 'N/A',
                    mtime: new Date().toISOString(),
                    thumbnail: (thumbnail || currentItemState?.thumbnail) || null,
                    clientId: clientId, // Machine-specific ID
                    // Add playlist info for folder grouping (prefer data from server)
                    isPlaylistItem: data.isPlaylistItem || currentItemState?.isPlaylistItem || false,
                    playlistId: data.playlistId || playlistId || currentItemState?.parentPlaylistId || null,
                    playlistTitle: data.playlistTitle || playlistTitle || currentItemState?.playlistTitle || null,
                    format: format || currentItemState?.format || null,
                    quality: quality || currentItemState?.quality || null
                };

                history.unshift(historyItem);
                persistStoredHistory(history);
                updateDownloadStats();
                break;
            case 'error':
                updateDownloadItemError(itemId, message, source);
                if (currentItemState) currentItemState.status = 'error';
                break;
            case 'cancel_confirm':
                updateDownloadItemStatus(itemId, message || 'Download cancelled.', source, 'cancelled');
                disableCancelButton(itemId, source);
                if (currentItemState) currentItemState.status = 'cancelled';
                removeDownloadItemAfterDelay(itemId);
                break;
            case 'pause_confirm':
                // Update UI to show paused state
                updateDownloadItemStatus(itemId, message || 'Download paused.', source, 'info');
                if (currentItemState) currentItemState.status = 'paused';
                // Update the pause/play button to show play icon
                const pausedItemDiv = document.getElementById(`item-${itemId}`);
                if (pausedItemDiv) {
                    const pausePlayBtn = pausedItemDiv.querySelector('.item-pause-play-btn');
                    if (pausePlayBtn) {
                        pausePlayBtn.innerHTML = '<i class="fas fa-play"></i>';
                        pausePlayBtn.title = 'Resume download';
                    }
                    // Hide progress bar when paused
                    const progressBarContainer = pausedItemDiv.querySelector('.progress-bar-container');
                    if (progressBarContainer) progressBarContainer.style.display = 'none';
                }
                updateDownloadStats();
                break;
            case 'tool_update_complete':
                // Handle automatic tool update notifications (yt-dlp only for auto-updates)
                if (data.ytdlp && data.ytdlp.updated) {
                    const updateMsg = `✅ yt-dlp updated: ${data.ytdlp.oldVersion} → ${data.ytdlp.newVersion}`;
                    console.log(updateMsg);
                    if (userSettings.notificationPopup) {
                        showDesktopNotification('Tool Updated', updateMsg);
                    }
                    // Show status message
                    const statusDivForUpdate = youtubeStatusDiv;
                    if (statusDivForUpdate) {
                        showStatus(updateMsg, 'youtube', 'success');
                    }
                }
                break;
            case 'status':
                const statusDivForGeneral = youtubeStatusDiv;
                if (statusDivForGeneral) {
                    if (isPotentialRateLimitMessage(message)) {
                        showPotentialRateLimitNotice(message);
                    } else {
                        showStatus(message, 'youtube', 'info');
                    }
                }
                // If this is a download status message, show the pause/play button and remove button
                if (message && message.includes('Downloading') && itemId) {
                    const itemDiv = document.getElementById(`item-${itemId}`);
                    if (itemDiv) {
                        const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
                        const removeBtn = itemDiv.querySelector('.item-remove-btn');
                        if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                        if (removeBtn) removeBtn.style.display = 'inline-flex';
                    }
                }
                break;
            case 'playlist_complete':
                const statusDivForPlaylist = youtubeStatusDiv;
                if (statusDivForPlaylist) {
                    showStatus(message || 'Playlist processing finished.', 'youtube', 'success');
                }
                break;
            default:
                console.warn('Unknown WebSocket message type:', type);
        }
    }

    // --- UI Updates ---
    function showStatus(message, downloaderSource, type = 'info') {
        void downloaderSource;
        const statusDiv = youtubeStatusDiv;
        if (statusDiv) {
            statusDiv.textContent = message;
            statusDiv.className = 'status-message';
            if (type === 'success') statusDiv.classList.add('success');
            else if (type === 'error') statusDiv.classList.add('error');
            else if (type === 'warning') statusDiv.classList.add('warning');
            else if (type === 'cancelled') statusDiv.classList.add('error');
        }
        announceLiveMessage(message);
    }

    function getLinksArea(source) {
        void source;
        return youtubeDownloadLinksArea;
    }

    function createDownloadItemStructure(itemId, titleText, source, isPlaylistItem = false) {
        const linksArea = getLinksArea(source);
        if (!linksArea || downloadItemsState.has(itemId)) return;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'download-item';
        itemDiv.id = `item-${itemId}`;
        itemDiv.dataset.itemId = itemId;

        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'item-thumbnail-container';

        const thumbnailImg = document.createElement('img');
        thumbnailImg.className = 'item-thumbnail';
        thumbnailImg.src = LOCAL_THUMBNAIL_PLACEHOLDER;
        thumbnailImg.alt = `${titleText} thumbnail`;
        thumbnailImg.addEventListener('error', () => {
            thumbnailImg.src = LOCAL_THUMBNAIL_PLACEHOLDER;
        }, { once: true });
        thumbnailContainer.appendChild(thumbnailImg);

        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'item-tags-container';

        const formatTag = document.createElement('span');
        formatTag.className = 'item-format-tag';
        formatTag.textContent = '';
        formatTag.style.display = 'none';
        tagsContainer.appendChild(formatTag);

        const qualityTag = document.createElement('span');
        qualityTag.className = 'item-quality-tag';
        qualityTag.textContent = '';
        qualityTag.style.display = 'none';
        tagsContainer.appendChild(qualityTag);

        thumbnailContainer.appendChild(tagsContainer);
        itemDiv.appendChild(thumbnailContainer);

        const itemContentDiv = document.createElement('div');
        itemContentDiv.className = 'item-content';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'item-title';
        titleDiv.textContent = titleText;
        itemContentDiv.appendChild(titleDiv);

        const statusDiv = document.createElement('div');
        statusDiv.className = 'item-status';
        statusDiv.textContent = 'Queued...';
        statusDiv.setAttribute('role', 'status');
        statusDiv.setAttribute('aria-live', 'polite');
        itemContentDiv.appendChild(statusDiv);

        const progressBarContainer = document.createElement('div');
        progressBarContainer.className = 'progress-bar-container';
        progressBarContainer.style.display = 'none';
        progressBarContainer.setAttribute('role', 'progressbar');
        progressBarContainer.setAttribute('aria-label', `${titleText} download progress`);
        progressBarContainer.setAttribute('aria-valuemin', '0');
        progressBarContainer.setAttribute('aria-valuemax', '100');
        progressBarContainer.setAttribute('aria-valuenow', '0');
        progressBarContainer.setAttribute('aria-valuetext', 'Queued');

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        progressBarContainer.appendChild(progressBar);
        itemContentDiv.appendChild(progressBarContainer);

        const linkDiv = document.createElement('div');
        linkDiv.className = 'item-link';
        itemContentDiv.appendChild(linkDiv);

        itemDiv.appendChild(itemContentDiv);

        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'item-buttons';

        // Control buttons row (pause, play, remove)
        const controlButtonsDiv = document.createElement('div');
        controlButtonsDiv.className = 'item-control-buttons';

        const pausePlayBtn = document.createElement('button');
        pausePlayBtn.className = 'item-control-btn item-pause-play-btn';
        pausePlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
        pausePlayBtn.title = 'Pause download';
        pausePlayBtn.setAttribute('aria-label', 'Pause download');
        pausePlayBtn.style.display = 'none';
        pausePlayBtn.onclick = () => handlePausePlayToggle(itemId, source);
        controlButtonsDiv.appendChild(pausePlayBtn);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'item-control-btn item-remove-btn';
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.title = 'Remove this item';
        removeBtn.setAttribute('aria-label', 'Remove this item');
        removeBtn.style.display = 'none';
        removeBtn.onclick = () => handleRemoveDownloadItem(itemId, source);
        controlButtonsDiv.appendChild(removeBtn);

        const retryBtn = document.createElement('button');
        retryBtn.className = 'item-control-btn item-retry-btn';
        retryBtn.innerHTML = '<i class="fas fa-rotate-right"></i>';
        retryBtn.title = 'Retry this download';
        retryBtn.setAttribute('aria-label', 'Retry this download');
        retryBtn.style.display = 'none';
        retryBtn.onclick = () => handleRetryDownload(itemId);
        controlButtonsDiv.appendChild(retryBtn);

        buttonsDiv.appendChild(controlButtonsDiv);

        // Cancel button (below control buttons)
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'item-cancel-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.setAttribute('aria-label', 'Cancel download');
        cancelBtn.onclick = () => handleCancelDownload(itemId, source);
        buttonsDiv.appendChild(cancelBtn);

        itemDiv.appendChild(buttonsDiv);
        if (emptyDownloadState && clearYoutubeDownloadsBtn) {
            emptyDownloadState.style.display = 'none';
            clearYoutubeDownloadsBtn.style.display = 'block';
            linksArea.insertBefore(itemDiv, clearYoutubeDownloadsBtn);
        } else {
            linksArea.prepend(itemDiv);
        }

        downloadItemsState.set(itemId, {
            title: titleText,
            status: 'queued',
            source: source,
            domElement: itemDiv,
            isPlaylist: isPlaylistItem, // Store the playlist flag
            thumbnailEl: thumbnailImg,
            lastAnnouncedProgressBucket: -1,
            retryable: false
        });

        updateDownloadStats();
    }

    function updateDownloadItemStatus(itemId, statusText, source, statusType = 'info') {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const statusEl = itemDiv.querySelector('.item-status');
            if (statusEl) {
                statusEl.textContent = statusText;
                statusEl.setAttribute('aria-label', statusText);
                statusEl.className = 'item-status';
                if (statusType === 'error') statusEl.classList.add('error-text');
                if (statusType === 'success') statusEl.classList.add('success-text');
                if (statusType === 'cancelled') statusEl.classList.add('cancelled-text');
            }
            const progressBarContainer = itemDiv.querySelector('.progress-bar-container');
            if (progressBarContainer && (statusType === 'error' || statusType === 'cancelled' || statusType === 'success')) {
                progressBarContainer.style.display = 'none';
            }
        }
    }

    function updateDownloadItemTitle(itemId, newTitle, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const titleEl = itemDiv.querySelector('.item-title');
            if (titleEl) {
                titleEl.textContent = newTitle;
            }
        }
    }

    function updateDownloadItemThumbnail(itemId, thumbnailUrl) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv && thumbnailUrl) {
            const img = itemDiv.querySelector('.item-thumbnail');
            if (img) {
                img.src = thumbnailUrl;
            }
        }
    }

    function updateDownloadItemFormat(itemId, format, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv && format) {
            const formatTag = itemDiv.querySelector('.item-format-tag');
            if (formatTag) {
                formatTag.textContent = format.toUpperCase();
                formatTag.style.display = 'inline-block';
            }
        }
    }

    function updateDownloadItemQuality(itemId, quality, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv && quality) {
            const qualityTag = itemDiv.querySelector('.item-quality-tag');
            if (qualityTag) {
                let qualityText = quality;
                if (quality === 'highest') {
                    qualityText = 'Best';
                } else if (!isNaN(parseInt(quality))) {
                    qualityText = `${quality}p`;
                }
                qualityTag.textContent = qualityText;
                qualityTag.style.display = 'inline-block';
            }
        }
    }

    function formatSpeed(speedBytesPerSec, unit) {
        if (typeof speedBytesPerSec !== 'number' || isNaN(speedBytesPerSec)) return '';
        if (unit === 'MBps') {
            return (speedBytesPerSec / 1e6).toFixed(2) + ' MB/s';
        } else if (unit === 'Mbps') {
            return ((speedBytesPerSec * 8) / 1e6).toFixed(2) + ' Mbps';
        } else {
            return speedBytesPerSec + ' B/s';
        }
    }

    function parseSpeedString(speedStr) {
        if (!speedStr || typeof speedStr !== 'string') return null;
        const match = speedStr.match(/([\d.]+)\s*(K|M|G)?i?B\/s/i);
        if (!match) return null;
        let value = parseFloat(match[1]);
        let unit = match[2] ? match[2].toUpperCase() : '';
        let bytes = value;
        if (unit === 'K') bytes *= 1024;
        else if (unit === 'M') bytes *= 1024 * 1024;
        else if (unit === 'G') bytes *= 1024 * 1024 * 1024;
        return bytes;
    }

    // Cache DOM elements for progress updates to avoid repeated queries
    const progressUpdateCache = new Map();

    // Throttled progress update for better performance
    const throttledProgressUpdate = throttle((itemId, progressData) => {
        requestAnimationFrame(() => {
            updateDownloadItemProgressInternal(itemId, progressData);
        });
    }, 100); // Update max every 100ms

    function updateDownloadItemProgress(itemId, message, percent, rawSpeed, source, speedBytesPerSec) {
        throttledProgressUpdate(itemId, { message, percent, rawSpeed, speedBytesPerSec });
    }

    function updateDownloadItemProgressInternal(itemId, { message, percent, rawSpeed, speedBytesPerSec }) {
        // Skip progress updates if item is already complete
        const itemState = downloadItemsState.get(itemId);
        if (itemState && itemState.status === 'complete') {
            return; // Don't update progress on completed items
        }

        let itemDiv = progressUpdateCache.get(`div-${itemId}`);
        if (!itemDiv) {
            itemDiv = document.getElementById(`item-${itemId}`);
            if (itemDiv) {
                // Cache DOM elements for this item
                progressUpdateCache.set(`div-${itemId}`, itemDiv);
                progressUpdateCache.set(`status-${itemId}`, itemDiv.querySelector('.item-status'));
                progressUpdateCache.set(`progressBar-${itemId}`, itemDiv.querySelector('.progress-bar'));
                progressUpdateCache.set(`progressBarContainer-${itemId}`, itemDiv.querySelector('.progress-bar-container'));
            }
        }

        if (!itemDiv) return;

        const statusEl = progressUpdateCache.get(`status-${itemId}`);
        const progressBarContainer = progressUpdateCache.get(`progressBarContainer-${itemId}`);
        const progressBar = progressUpdateCache.get(`progressBar-${itemId}`);

        let progressText = '';
        if (typeof percent === 'number' && !isNaN(percent)) {
            progressText += percent.toFixed(1) + '%';
        }
        let speedText = '';
        let speedVal = null;
        if (typeof speedBytesPerSec === 'number' && !isNaN(speedBytesPerSec)) {
            speedVal = speedBytesPerSec;
        } else if (rawSpeed) {
            speedVal = parseSpeedString(rawSpeed);
        }
        if (speedVal !== null) {
            speedText = formatSpeed(speedVal, userSettings.speedUnitDisplay);
        }
        if (speedText) {
            if (progressText) progressText += ' at ';
            progressText += speedText;
        }
        if (!progressText && message) {
            progressText = message;
        }
        if (statusEl) statusEl.textContent = progressText || 'Processing...';
        if (progressBarContainer) progressBarContainer.style.display = 'block';
        if (progressBar && typeof percent === 'number' && !isNaN(percent)) {
            const clampedPercent = Math.max(0, Math.min(100, percent));
            progressBar.style.width = `${clampedPercent}%`;
            progressBarContainer.setAttribute('aria-valuenow', String(Math.round(clampedPercent)));
            progressBarContainer.setAttribute('aria-valuetext', progressText || `${Math.round(clampedPercent)}% complete`);
        }
        if (statusEl) {
            statusEl.setAttribute('aria-label', progressText || 'Processing...');
        }

        // Show pause/play button and remove button when download starts (when progress > 0)
        if (typeof percent === 'number' && percent > 0) {
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            const removeBtn = itemDiv.querySelector('.item-remove-btn');
            if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        }

        if (typeof percent === 'number' && !isNaN(percent) && itemState) {
            const progressBucket = Math.floor(Math.max(0, Math.min(100, percent)) / 10);
            if (progressBucket > itemState.lastAnnouncedProgressBucket) {
                itemState.lastAnnouncedProgressBucket = progressBucket;
                const title = itemState.title || itemDiv.querySelector('.item-title')?.textContent || 'Download';
                announceLiveMessage(`${title} ${Math.round(percent)}% complete${speedText ? ` at ${speedText}` : ''}`);
            }
        }
    }

    function updateDownloadItemComplete(itemId, message, downloadUrl, filename, actualSize, source, fullPath, thumb, cleanTitle) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            // Update title with clean title if provided
            if (cleanTitle) {
                updateDownloadItemTitle(itemId, cleanTitle, source);
                const currentItemState = downloadItemsState.get(itemId);
                if (currentItemState) {
                    currentItemState.title = cleanTitle;
                }
            }

            // Update item state to complete
            const itemState = downloadItemsState.get(itemId);
            if (itemState) {
                itemState.status = 'complete';
                itemState.retryable = false;
            }

            // Force progress bar to 100% before hiding
            const progressBar = itemDiv.querySelector('.progress-bar');
            const progressBarContainer = itemDiv.querySelector('.progress-bar-container');
            if (progressBar) {
                progressBar.style.width = '100%';
            }
            // Hide progress bar after a short delay so user sees 100%
            setTimeout(() => {
                if (progressBarContainer) progressBarContainer.style.display = 'none';
            }, 300);

            // Compact status message: "Download complete • filesize" or the server-provided message
            let statusText = message || `Download complete${actualSize ? ' • ' + actualSize : ''}`;
            // If the message is just "Download complete!", append the size if available
            if (message === 'Download complete!' && actualSize) {
                statusText = `Download complete • ${actualSize}`;
            } else if (message.includes('Download complete!') && actualSize && !message.includes(actualSize)) {
                statusText = message.replace('Download complete!', `Download complete • ${actualSize}`);
            }
            updateDownloadItemStatus(itemId, statusText, source, 'success');

            const linkEl = itemDiv.querySelector('.item-link');
            if (linkEl) {
                linkEl.innerHTML = '';

                // Create folder button if we have any way to open the folder
                const hasPath = fullPath || downloadUrl || getDownloadFolder();
                if (hasPath) {
                    const openFolderBtn = document.createElement('button');
                    openFolderBtn.className = 'modern-folder-btn compact-folder-btn';
                    openFolderBtn.title = 'Open containing folder';
                    openFolderBtn.innerHTML = '<i class="fas fa-folder-open"></i> Open Folder';
                    openFolderBtn.onclick = async () => {
                        if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                            try {
                                let targetPath = fullPath;
                                const downloadRoot = getDownloadFolder();
                                if (!targetPath && downloadUrl && window.electronAPI?.resolvePath) {
                                    const rel = decodeURIComponent(downloadUrl.replace('/downloads/', ''));
                                    targetPath = await window.electronAPI.resolvePath(downloadRoot, rel);
                                }
                                const folderPath = window.electronAPI?.getDirname && targetPath
                                    ? await window.electronAPI.getDirname(targetPath)
                                    : downloadRoot;
                                await window.electronAPI.openPathInExplorer(downloadRoot, folderPath);
                            } catch (e) {
                                console.error('Open folder failed:', e);
                                showAlert('Unable to open containing folder.', 'Error');
                            }
                        } else {
                            console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                            showAlert('Open folder not available. Make sure you are running in Electron.', 'Not Available');
                        }
                    };
                    linkEl.appendChild(openFolderBtn);
                }
            }
            if (thumb) updateDownloadItemThumbnail(itemId, thumb);
            disableCancelButton(itemId, source);
            showActionButtons(itemId);

            // Hide pause/play and cancel buttons when download completes
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            if (pausePlayBtn) pausePlayBtn.style.display = 'none';
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            if (cancelBtn) cancelBtn.style.display = 'none';

            // Update download stats
            updateDownloadStats();
            updateRetryFailedButtonVisibility();
        }
    }

    function updateDownloadItemError(itemId, errorMessage, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        const itemState = downloadItemsState.get(itemId);
        if (itemDiv) {
            updateDownloadItemStatus(itemId, `Error: ${errorMessage}`, source, 'error');
            disableCancelButton(itemId, source);
            if (itemState) {
                itemState.retryable = true;
            }
            showActionButtons(itemId);
        }
        updateRetryFailedButtonVisibility();
        showFailureHelp(errorMessage);
    }

    function disableCancelButton(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            if (cancelBtn) {
                cancelBtn.disabled = true;
                cancelBtn.textContent = 'Done';
                cancelBtn.style.opacity = '0.6';
                cancelBtn.style.cursor = 'default';
            }
        }
    }

    function handleCancelDownload(itemId, source) {
        console.log(`Cancelling download for item: ${itemId}, source: ${source}`);
        sendMessageToServer('cancel', { itemId: itemId });
        updateDownloadItemStatus(itemId, 'Cancelling...', source);
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            if (cancelBtn) cancelBtn.disabled = true;
        }
    }

    function handleRemoveDownloadItem(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) itemDiv.remove();
        downloadItemsState.delete(itemId);
        // Clear cache for removed item
        progressUpdateCache.delete(`div-${itemId}`);
        progressUpdateCache.delete(`status-${itemId}`);
        progressUpdateCache.delete(`progressBar-${itemId}`);
        progressUpdateCache.delete(`progressBarContainer-${itemId}`);
        updateDownloadStats();
        updateRetryFailedButtonVisibility();
        console.log(`Removed item ${itemId} from UI and state.`);
    }

    function updateRetryFailedButtonVisibility() {
        if (!retryFailedDownloadsBtn) return;
        const hasRetryableItems = Array.from(downloadItemsState.values()).some((item) => item.retryable === true);
        setElementHiddenState(retryFailedDownloadsBtn, !hasRetryableItems);
        retryFailedDownloadsBtn.style.display = hasRetryableItems ? 'inline-flex' : 'none';
    }

    function showActionButtons(itemId) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const removeBtn = itemDiv.querySelector('.item-remove-btn');
            if (removeBtn) removeBtn.style.display = 'inline-flex';
            const retryBtn = itemDiv.querySelector('.item-retry-btn');
            const itemState = downloadItemsState.get(itemId);
            if (retryBtn) {
                retryBtn.style.display = itemState?.retryable ? 'inline-flex' : 'none';
            }
        }
    }

    async function handleRetryDownload(itemId) {
        try {
            const response = await window.localApiAuth.authorizedFetch(`/failed-downloads/${encodeURIComponent(itemId)}/retry`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ clientId })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || `Retry failed with ${response.status}`);
            }
            const itemState = downloadItemsState.get(itemId);
            if (itemState) {
                itemState.retryable = false;
                itemState.status = 'queued';
            }
            handleRemoveDownloadItem(itemId, 'youtube');
            updateRetryFailedButtonVisibility();
            showStatus('Retry requested...', 'youtube', 'success');
        } catch (error) {
            showStatus(`Could not retry download: ${error.message}`, 'youtube', 'error');
        }
    }

    // Dynamic pause/play toggle function
    function handlePausePlayToggle(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            if (pausePlayBtn) {
                const isPaused = pausePlayBtn.innerHTML.includes('fa-play');
                const currentItemState = downloadItemsState.get(itemId);

                if (isPaused) {
                    // Currently paused, resume download
                    console.log(`Resuming download for item: ${itemId}, source: ${source}`);
                    sendMessageToServer('resume', { itemId: itemId });
                    pausePlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    pausePlayBtn.title = 'Pause download';
                    updateDownloadItemStatus(itemId, 'Resuming...', source);

                    // Update state
                    if (currentItemState) currentItemState.status = 'resuming';

                    // Show progress bar again
                    const progressBarContainer = itemDiv.querySelector('.progress-bar-container');
                    if (progressBarContainer) progressBarContainer.style.display = 'block';
                } else {
                    // Currently downloading, pause download
                    console.log(`Pausing download for item: ${itemId}, source: ${source}`);
                    sendMessageToServer('pause', { itemId: itemId });
                    pausePlayBtn.innerHTML = '<i class="fas fa-play"></i>';
                    pausePlayBtn.title = 'Resume download';
                    updateDownloadItemStatus(itemId, 'Pausing...', source);

                    // Update state (will be confirmed by pause_confirm from server)
                    if (currentItemState) currentItemState.status = 'pausing';
                }
            }
        }
        updateDownloadStats();
    }

    // --- Download Initiation ---
    async function fetchVideoInfo(url, source, options = {}) {
        if (!youtubeUrlInput) return null;
        const { forceRefresh = false, showErrors = true } = options;
        const normalizedUrl = normalizePreviewUrl(url);
        if (!normalizedUrl) {
            return null;
        }

        const cachedPreviewInfo = !forceRefresh ? getCachedPreviewInfo(normalizedUrl) : null;
        if (cachedPreviewInfo) {
            return cachedPreviewInfo;
        }

        const pendingPreviewRequest = pendingPreviewRequests.get(normalizedUrl);
        if (pendingPreviewRequest) {
            return pendingPreviewRequest;
        }

        if (navigator.onLine === false) {
            if (showErrors) {
                showStatus('You are offline. Reconnect before fetching video info.', source, 'error');
            }
            return null;
        }
        if (showErrors) {
            hideFailureHelp();
        }

        // Check if URL is blocked
        const blocked = window.contentFilter_isBlockedUrl ? window.contentFilter_isBlockedUrl(normalizedUrl) : { blocked: false };
        if (blocked.blocked) {
            if (showErrors) {
                const statusDiv = youtubeStatusDiv;
                if (statusDiv) {
                    const reason = blocked.reason === 'pornography'
                        ? 'Pornography sites are not allowed.'
                        : 'Gambling sites are not allowed.';
                    showStatus(reason, source, 'error');
                }
            }
            return null;
        }

        const requestPromise = (async () => {
            try {
                const response = await window.localApiAuth.authorizedFetch('/video-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: normalizedUrl, clientId, source })
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
                    throw new Error(errorData.error || `HTTP error ${response.status}`);
                }
                const videoInfo = await response.json();
                setCachedPreviewInfo(normalizedUrl, videoInfo);
                return videoInfo;
            } catch (error) {
                console.error(`Error fetching video info for ${normalizedUrl} (${source}):`, error);
                if (showErrors) {
                    const statusDiv = youtubeStatusDiv;
                    if (statusDiv) {
                        showStatus(`Error fetching info: ${error.message}`, source, 'error');
                    }
                    showFailureHelp(error.message);
                }
                return null;
            } finally {
                pendingPreviewRequests.delete(normalizedUrl);
            }
        })();

        pendingPreviewRequests.set(normalizedUrl, requestPromise);
        return requestPromise;
    }

    async function fetchPlaylistPreview(url) {
        const response = await window.localApiAuth.authorizedFetch('/playlist-preview', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url,
                clientId
            })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `Playlist preview failed with ${response.status}`);
        }
        return response.json();
    }

    function renderPlaylistSelectionItems(preview) {
        if (!playlistSelectionList) return;
        playlistSelectionList.innerHTML = '';
        preview.items.forEach((item) => {
            const label = document.createElement('label');
            label.className = 'playlist-selection-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = item.id;
            checkbox.checked = true;
            checkbox.dataset.playlistId = item.id;

            const text = document.createElement('span');
            text.textContent = `${item.index + 1}. ${item.title}`;

            label.append(checkbox, text);
            playlistSelectionList.appendChild(label);
        });
    }

    function getSelectedPlaylistItemIds() {
        if (!playlistSelectionList) return [];
        return Array.from(playlistSelectionList.querySelectorAll('input[type="checkbox"]:checked'))
            .map((checkbox) => checkbox.value);
    }

    async function openPlaylistSelectionFlow(requestPayload) {
        const preview = await fetchPlaylistPreview(requestPayload.url);
        pendingPlaylistSelectionRequest = requestPayload;
        if (playlistSelectionSummary) {
            playlistSelectionSummary.textContent = `${preview.title} • ${preview.items.length} item${preview.items.length === 1 ? '' : 's'} found.`;
        }
        renderPlaylistSelectionItems(preview);
        if (playlistSelectionModal) {
            openModalWithFocus(playlistSelectionModal, closePlaylistSelectionBtn || confirmPlaylistSelectionBtn);
        }
    }

    function closePlaylistSelectionFlow() {
        pendingPlaylistSelectionRequest = null;
        if (playlistSelectionModal) {
            closeModalWithFocusRestore(playlistSelectionModal);
        }
        if (playlistSelectionList) {
            playlistSelectionList.innerHTML = '';
        }
    }

    function createScheduledDownloadItem(schedule) {
        const itemId = schedule.scheduleId;
        createDownloadItemStructure(itemId, schedule.title || 'Scheduled download', schedule.source || 'youtube', schedule.playlistAction === 'full');
        updateDownloadItemStatus(itemId, `Scheduled for ${new Date(schedule.scheduledFor).toLocaleString()}`, schedule.source || 'youtube', 'info');
        const itemState = downloadItemsState.get(itemId);
        if (itemState) {
            itemState.status = 'scheduled';
            itemState.scheduleId = schedule.scheduleId;
            itemState.retryable = false;
        }
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            const retryBtn = itemDiv.querySelector('.item-retry-btn');
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            const removeBtn = itemDiv.querySelector('.item-remove-btn');
            if (pausePlayBtn) pausePlayBtn.style.display = 'none';
            if (retryBtn) retryBtn.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
            if (cancelBtn) {
                cancelBtn.textContent = 'Cancel Schedule';
                cancelBtn.onclick = () => handleDeleteScheduledDownload(schedule.scheduleId);
            }
        }
    }

    async function loadRecoverableDownloads() {
        try {
            const [recoverableResponse, scheduledResponse, failedResponse] = await Promise.all([
                window.localApiAuth.authorizedFetch(`/recoverable-downloads?clientId=${encodeURIComponent(clientId)}`),
                window.localApiAuth.authorizedFetch(`/scheduled-downloads?clientId=${encodeURIComponent(clientId)}`),
                window.localApiAuth.authorizedFetch(`/failed-downloads?clientId=${encodeURIComponent(clientId)}`)
            ]);

            if (recoverableResponse.ok) {
                const data = await recoverableResponse.json();
                (data.items || []).forEach((item) => {
                    createDownloadItemStructure(item.itemId, item.title || 'Recoverable download', item.source || 'youtube', item.isPlaylistItem);
                    updateDownloadItemStatus(item.itemId, 'Paused. Ready to resume after restart.', item.source || 'youtube', 'info');
                    const itemState = downloadItemsState.get(item.itemId);
                    if (itemState) {
                        itemState.status = 'paused';
                    }
                    const itemDiv = document.getElementById(`item-${item.itemId}`);
                    const pausePlayBtn = itemDiv?.querySelector('.item-pause-play-btn');
                    if (pausePlayBtn) {
                        pausePlayBtn.style.display = 'inline-flex';
                        pausePlayBtn.innerHTML = '<i class="fas fa-play"></i>';
                        pausePlayBtn.title = 'Resume download';
                    }
                });
            }

            if (scheduledResponse.ok) {
                const data = await scheduledResponse.json();
                (data.items || []).forEach((schedule) => {
                    createScheduledDownloadItem(schedule);
                });
            }

            if (failedResponse.ok) {
                const data = await failedResponse.json();
                (data.items || []).forEach((failed) => {
                    createDownloadItemStructure(failed.itemId, failed.title || 'Failed download', failed.source || 'youtube', false);
                    updateDownloadItemError(failed.itemId, failed.message || 'Download failed', failed.source || 'youtube');
                });
            }
            updateRetryFailedButtonVisibility();
        } catch (error) {
            console.warn('Could not load recoverable download state:', error);
        }
    }

    async function handleDeleteScheduledDownload(scheduleId) {
        try {
            const response = await window.localApiAuth.authorizedFetch(`/scheduled-downloads/${encodeURIComponent(scheduleId)}?clientId=${encodeURIComponent(clientId)}`, {
                method: 'DELETE'
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || `Schedule delete failed with ${response.status}`);
            }
            handleRemoveDownloadItem(scheduleId, 'youtube');
        } catch (error) {
            showStatus(`Could not cancel scheduled download: ${error.message}`, 'youtube', 'error');
        }
    }

    async function startDownloadCommon(url, format, quality, source, playlistActionVal, concurrencyVal, singleConcurrencyVal, options = {}) {
        const statusDiv = youtubeStatusDiv;
        if (!url) {
            if (statusDiv) showStatus('Please paste a URL.', source, 'error');
            return;
        }
        if (navigator.onLine === false) {
            if (statusDiv) showStatus('You are offline. Reconnect before starting downloads.', source, 'error');
            return;
        }

        // Check if URL is blocked
        const blocked = window.contentFilter_isBlockedUrl ? window.contentFilter_isBlockedUrl(url) : { blocked: false };
        if (blocked.blocked) {
            if (statusDiv) {
                const reason = blocked.reason === 'pornography'
                    ? 'Pornography sites are not allowed.'
                    : 'Gambling sites are not allowed.';
                showStatus(reason, source, 'error');
            }
            return;
        }

        if (statusDiv) showStatus('Requesting download...', source, 'info');
        hideFailureHelp();

        const payload = {
            url, format, quality, clientId, source,
            playlistAction: playlistActionVal,
            concurrency: concurrencyVal,
            singleConcurrency: singleConcurrencyVal,
            selectedPlaylistItems: Array.isArray(options.selectedPlaylistItems) ? options.selectedPlaylistItems : [],
            ...userSettings,
            downloadFolder: getDownloadFolder()
        };
        const scheduledFor = scheduleDownloadToggle?.checked ? scheduleDownloadAt?.value : '';
        if (scheduledFor) {
            payload.scheduledFor = scheduledFor;
            payload.previewTitle = youtubeUrlInput?.value?.trim() || url;
            const response = await window.localApiAuth.authorizedFetch('/scheduled-downloads', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || `Scheduling failed with ${response.status}`);
            }
            const scheduled = await response.json();
            createScheduledDownloadItem({
                scheduleId: scheduled.scheduleId,
                scheduledFor: scheduled.scheduledFor,
                title: payload.previewTitle,
                source,
                format,
                quality,
                playlistAction: playlistActionVal
            });
            if (statusDiv) {
                showStatus(`Download scheduled for ${new Date(scheduled.scheduledFor).toLocaleString()}.`, source, 'success');
            }
            return;
        }
        const normalizedUrl = normalizePreviewUrl(url);
        if (source === 'youtube' && isPreviewableUrl(normalizedUrl) && !isLikelyPlaylistUrl(normalizedUrl) && !getCachedPreviewInfo(normalizedUrl)) {
            fetchVideoInfo(normalizedUrl, source, { showErrors: false }).catch((error) => {
                console.warn('Failed to warm preview metadata before download:', error);
            });
        }
        sendMessageToServer('download_request', payload);
    }

    if (startYoutubeDownloadBtn) {
        startYoutubeDownloadBtn.onclick = async () => {
            // --- First-run rights confirmation ---
            const hasConfirmedRights = localStorage.getItem('simplyytd_rights_confirmed') === 'true';
            const firstRunBox = document.getElementById('firstRunConfirmation');
            const confirmCheckbox = document.getElementById('confirmRightsCheckbox');

            if (!hasConfirmedRights) {
                // Show confirmation box if not already confirmed
                if (firstRunBox) {
                    firstRunBox.style.display = 'block';
                }

                if (confirmCheckbox && !confirmCheckbox.checked) {
                    showStatus('Please confirm you have the rights to download this content.', 'youtube', 'error');
                    confirmCheckbox.focus();
                    return;
                }

                // Save confirmation
                if (confirmCheckbox && confirmCheckbox.checked) {
                    localStorage.setItem('simplyytd_rights_confirmed', 'true');
                    if (firstRunBox) firstRunBox.style.display = 'none';
                }
            }

            const url = youtubeUrlInput.value.trim();
            const format = formatSelect.value;
            const qualityVal = qualitySelect.value;
            const singleConcurrencySelect = document.getElementById('singleConcurrencySelect');
            const singleConcurrency = singleConcurrencySelect ? singleConcurrencySelect.value : '1';
            // Check if playlist options are visible (detected by detectPlaylist function)
            const isPlaylist = playlistOptionsDiv && playlistOptionsDiv.style.display !== 'none';
            const playlistAction = isPlaylist && playlistActionSelect ? playlistActionSelect.value : 'single';
            const concurrency = isPlaylist && playlistAction === 'full' && playlistConcurrencySelect ? playlistConcurrencySelect.value : 1;

            // Use 'youtube' source for backwards compatibility, but backend will handle all sites uniformly
            const requestPayload = {
                url,
                format,
                quality: qualityVal,
                source: 'youtube',
                playlistAction,
                concurrency: parseInt(concurrency),
                singleConcurrency: parseInt(singleConcurrency)
            };
            try {
                if (isPlaylist && playlistAction === 'full') {
                    await openPlaylistSelectionFlow(requestPayload);
                    return;
                }
                await startDownloadCommon(url, format, qualityVal, 'youtube', playlistAction, parseInt(concurrency), parseInt(singleConcurrency));
            } catch (error) {
                showStatus(`Could not start download: ${error.message}`, 'youtube', 'error');
            }
        };
    }

    // --- Quality Options & Playlist Detection ---
    // --- Quality Options & Playlist Detection ---
    function populateQualityOptions(selectElement, format, source, preserveValue = false) {
        if (!selectElement) return;

        // Store current value if we want to preserve it
        const currentValue = preserveValue ? selectElement.value : null;
        selectElement.innerHTML = '';

        const videoFormats = ['mp4', 'mkv', 'mov', 'webm'];
        const audioFormats = ['mp3', 'wav', 'm4a', 'opus', 'flac'];
        const isVideoFormat = videoFormats.includes(format);
        const isAudioFormat = audioFormats.includes(format);

        let qualities = [];
        if (source === 'youtube') {
            if (isVideoFormat) {
                qualities = [
                    { value: 'highest', text: 'Best available (up to 8K)' },
                    { value: '2160', text: '4K (2160p)' },
                    { value: '1440', text: '2K (1440p)' },
                    { value: '1080', text: '1080p' },
                    { value: '720', text: '720p' },
                    { value: '480', text: '480p' },
                    { value: '360', text: '360p' }
                ];
            } else if (isAudioFormat) {
                qualities = [
                    { value: 'highest', text: 'Highest Quality' },
                    { value: '320', text: '320 kbps' },
                    { value: '256', text: '256 kbps' },
                    { value: '192', text: '192 kbps' },
                    { value: '128', text: '128 kbps' }
                ];
            }
        }

        let foundPreservedValue = false;
        qualities.forEach(q => {
            const option = document.createElement('option');
            option.value = q.value;
            option.textContent = q.text;
            // Restore previous selection if it exists in the new list
            if (preserveValue && currentValue && q.value === currentValue) {
                option.selected = true;
                foundPreservedValue = true;
            }
            selectElement.appendChild(option);
        });

        // If the preserved value wasn't found, keep the default (first option)
        if (preserveValue && currentValue && !foundPreservedValue) {
            selectElement.selectedIndex = 0;
        }
    }

    if (formatSelect && qualitySelect) {
        formatSelect.addEventListener('change', () => populateQualityOptions(qualitySelect, formatSelect.value, 'youtube', true));
        populateQualityOptions(qualitySelect, formatSelect.value, 'youtube');
    }
    function detectPlaylist() {
        if (!youtubeUrlInput || !playlistOptionsDiv) return;
        const url = youtubeUrlInput.value.trim();
        // Check for common playlist indicators (yt-dlp will handle actual detection)
        const isPlaylist = isLikelyPlaylistUrl(url);
        playlistOptionsDiv.style.display = isPlaylist ? 'block' : 'none';
        if (playlistOptionsDiv.style.display === 'block' && playlistActionSelect) {
            playlistActionSelect.dispatchEvent(new Event('change'));
        }
    }
    if (youtubeUrlInput && playlistOptionsDiv && playlistActionSelect) {
        youtubeUrlInput.addEventListener('input', () => {
            detectPlaylist();
            scheduleYoutubePreview();
        });
        youtubeUrlInput.addEventListener('blur', () => {
            scheduleYoutubePreview({ immediate: true });
        });
        detectPlaylist();
    }
    if (playlistActionSelect) {
        playlistActionSelect.addEventListener('change', () => {
            const concurrencyGroup = document.getElementById('concurrencyGroup');
            if (concurrencyGroup) {
                concurrencyGroup.style.display = playlistActionSelect.value === 'full' ? 'block' : 'none';
            }
        });
        const initialConcurrencyGroup = document.getElementById('concurrencyGroup');
        if (initialConcurrencyGroup) {
            initialConcurrencyGroup.style.display = playlistActionSelect.value === 'full' ? 'block' : 'none';
        }
    }

    if (scheduleDownloadToggle && scheduleDownloadAt) {
        scheduleDownloadToggle.addEventListener('change', () => {
            const showScheduler = scheduleDownloadToggle.checked === true;
            if (showScheduler && advancedDownloadOptions) {
                advancedDownloadOptions.open = true;
            }
            setElementHiddenState(scheduleDownloadAt, !showScheduler);
            scheduleDownloadAt.style.display = showScheduler ? 'block' : 'none';
            if (showScheduler && !scheduleDownloadAt.value) {
                const defaultDate = new Date(Date.now() + 15 * 60 * 1000);
                const localValue = new Date(defaultDate.getTime() - defaultDate.getTimezoneOffset() * 60000)
                    .toISOString()
                    .slice(0, 16);
                scheduleDownloadAt.value = localValue;
            }
        });

        const showScheduler = scheduleDownloadToggle.checked === true;
        if (advancedDownloadOptions && showScheduler) {
            advancedDownloadOptions.open = true;
        }
        setElementHiddenState(scheduleDownloadAt, !showScheduler);
        scheduleDownloadAt.style.display = showScheduler ? 'block' : 'none';
    }

    if (retryFailedDownloadsBtn) {
        retryFailedDownloadsBtn.addEventListener('click', async () => {
            try {
                const response = await window.localApiAuth.authorizedFetch('/failed-downloads/retry-all', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ clientId })
                });
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.error || `Retry all failed with ${response.status}`);
                }
                Array.from(downloadItemsState.entries()).forEach(([itemId, item]) => {
                    if (item.retryable) {
                        handleRemoveDownloadItem(itemId, 'youtube');
                    }
                });
                updateRetryFailedButtonVisibility();
                showStatus('Retrying all failed downloads...', 'youtube', 'success');
            } catch (error) {
                showStatus(`Could not retry failed downloads: ${error.message}`, 'youtube', 'error');
            }
        });
    }

    // --- Tab Management ---
    function showTab(tab) {
        ['youtubeDownloader', 'historyPanel'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        ['youtubeTab', 'historyTab'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('active');
        });
        const panelId = tab === 'history' ? 'historyPanel' : `${tab}Downloader`;
        const navId = `${tab}Tab`;
        const panel = document.getElementById(panelId);
        const nav = document.getElementById(navId);
        if (panel) panel.style.display = 'block';
        if (nav) nav.classList.add('active');
        activeDownloader = tab;
        localStorage.setItem('activeDownloader', tab);
        if (tab === 'youtube') {
            detectPlaylist();
            if (ws && ws.readyState === WebSocket.OPEN && youtubeStatusDiv) {
                showStatus('Connected to server.', 'youtube', 'success');
            }
        }
    }
    if (youtubeTab) youtubeTab.onclick = (e) => { e.preventDefault(); showTab('youtube'); };
    if (historyTab) historyTab.onclick = (e) => { e.preventDefault(); showTab('history'); };

    // --- Theme Management ---
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        // Arrow icons are handled by CSS theme-specific rules
        document.querySelectorAll('.progress-bar').forEach(pb => {
            if (!pb) return;
            pb.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--progress-bar-bg').trim();
        });
    }

    // --- UI Scale Management ---
    const UI_SCALE_MIN = 0.6;
    const UI_SCALE_STANDARD_MIN = 0.7;
    const UI_SCALE_STANDARD_MAX = 1.1;
    const UI_SCALE_MAX = 1.5;
    const UI_SCALE_MIN_FONT_PX = 12;
    const UI_SCALE_LOW_FONT_PX = 14;
    const UI_SCALE_STANDARD_FONT_PX = 16;
    const UI_SCALE_STANDARD_MAX_FONT_PX = 16.5;
    const UI_SCALE_MAX_FONT_PX = 18;

    function clampNumber(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getUIScaleFontSizePx(scale) {
        const safeScale = clampNumber(Number(scale) || 1, UI_SCALE_MIN, UI_SCALE_MAX);

        if (safeScale <= UI_SCALE_STANDARD_MIN) {
            const progress = (safeScale - UI_SCALE_MIN) / (UI_SCALE_STANDARD_MIN - UI_SCALE_MIN);
            return UI_SCALE_MIN_FONT_PX + (clampNumber(progress, 0, 1) * (UI_SCALE_LOW_FONT_PX - UI_SCALE_MIN_FONT_PX));
        }

        if (safeScale <= UI_SCALE_STANDARD_MAX) {
            const progress = (safeScale - UI_SCALE_STANDARD_MIN) / (UI_SCALE_STANDARD_MAX - UI_SCALE_STANDARD_MIN);
            return UI_SCALE_LOW_FONT_PX + (clampNumber(progress, 0, 1) * (UI_SCALE_STANDARD_MAX_FONT_PX - UI_SCALE_LOW_FONT_PX));
        }

        const progress = (safeScale - UI_SCALE_STANDARD_MAX) / (UI_SCALE_MAX - UI_SCALE_STANDARD_MAX);
        return UI_SCALE_STANDARD_MAX_FONT_PX + (clampNumber(progress, 0, 1) * (UI_SCALE_MAX_FONT_PX - UI_SCALE_STANDARD_MAX_FONT_PX));
    }

    function formatUIScaleLabel(scale) {
        const safeScale = clampNumber(Number(scale) || 1, UI_SCALE_MIN, UI_SCALE_MAX);
        return `${Math.round(safeScale * 100)}%`;
    }

    function getUIDensityMode(scale) {
        const safeScale = clampNumber(Number(scale) || 1, UI_SCALE_MIN, UI_SCALE_MAX);
        if (safeScale <= 0.9) return 'compact';
        if (safeScale >= 1.25) return 'relaxed';
        return 'standard';
    }

    function applyUIScale(scale) {
        const safeScale = clampNumber(Number(scale) || 1, UI_SCALE_MIN, UI_SCALE_MAX);
        const fontSizePx = getUIScaleFontSizePx(safeScale);
        const rootFontRem = fontSizePx / 16;
        document.documentElement.style.fontSize = `${rootFontRem}rem`;
        if (document.body) {
            document.body.style.fontSize = '';
            document.body.setAttribute('data-ui-density', getUIDensityMode(safeScale));
        }
        localStorage.setItem('uiScale', safeScale);
        console.log(`UI scale applied: ${safeScale} -> ${fontSizePx}px (${rootFontRem}rem)`);
    }

    // --- Settings Modal ---
    function loadSettings() {
        const defaults = {
            maxSpeed: 0,
            numerateFiles: false,
            skipDuplicates: false,
            removeCompleted: false,
            notificationSound: true,
            notificationPopup: true,
            speedUnitDisplay: 'Mbps',
            downloadFolder: '',
            skipDeleteConfirmation: false,
            themePreset: 'light',
            keepPcAwake: true,
            uiScale: 1.0, // Add UI scale default
            autoUpdateTools: true, // Enable auto-updates by default
            errorTelemetry: false, // Opt-in error telemetry (default: disabled for privacy)
            startWithWindows: false, // Start app with Windows (default: disabled)
            supportPopupDisabled: false,
subtitleMode: 'none',
            subtitleLanguages: 'en.*,en',
includeAutoCaptions: false,
            smartRetry: true,
            smartRetryAttempts: 3,
            lanAccess: false
        };
        const storedSettings = localStorage.getItem('ytdUserSettings');
        let settings = storedSettings ? JSON.parse(storedSettings) : { ...defaults };
        for (const key in defaults) if (settings[key] === undefined) settings[key] = defaults[key];
        return settings;
    }

    function saveSettings() {
        // Ensure checkbox is found
        if (!keepPcAwakeCheckbox) {
            keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
        }

        const autoUpdateToolsCheckbox = document.getElementById('autoUpdateTools');
        const errorTelemetryCheckbox = document.getElementById('errorTelemetry');
        const startWithWindowsCheckbox = document.getElementById('startWithWindows');

        // Get the new startWithWindows value
        const newStartWithWindows = startWithWindowsCheckbox ? startWithWindowsCheckbox.checked : false;
        const oldStartWithWindows = userSettings.startWithWindows;

        userSettings = {
            maxSpeed: maxSpeedInput ? (parseInt(maxSpeedInput.value, 10) || 0) : 0,
            numerateFiles: numerateFilesCheckbox ? numerateFilesCheckbox.checked : false,
            skipDuplicates: skipDuplicatesCheckbox ? skipDuplicatesCheckbox.checked : false,
            removeCompleted: removeCompletedCheckbox ? removeCompletedCheckbox.checked : false,
            notificationSound: notificationSoundCheckbox ? notificationSoundCheckbox.checked : true,
            notificationPopup: notificationPopupCheckbox ? notificationPopupCheckbox.checked : true,
            speedUnitDisplay: speedUnitDisplaySelect ? speedUnitDisplaySelect.value : 'Mbps',
            downloadFolder: downloadFolderInput ? downloadFolderInput.value : '',
            skipDeleteConfirmation: skipDeleteConfirmationCheckbox ? skipDeleteConfirmationCheckbox.checked : false,
            themePreset: themePresetSelect ? themePresetSelect.value : 'light',
            keepPcAwake: keepPcAwakeCheckbox ? keepPcAwakeCheckbox.checked : true,
            uiScale: document.getElementById('uiScale') ? parseFloat(document.getElementById('uiScale').value) || 1.0 : 1.0,
            autoUpdateTools: autoUpdateToolsCheckbox ? autoUpdateToolsCheckbox.checked : true,
            errorTelemetry: errorTelemetryCheckbox ? errorTelemetryCheckbox.checked : false,
            startWithWindows: newStartWithWindows,
            supportPopupDisabled: userSettings.supportPopupDisabled === true,
subtitleMode: subtitleModeSelect ? subtitleModeSelect.value : 'none',
            subtitleLanguages: subtitleLanguagesInput ? subtitleLanguagesInput.value.trim() || 'en.*,en' : 'en.*,en',
includeAutoCaptions: includeAutoCaptionsCheckbox ? includeAutoCaptionsCheckbox.checked : false,
            smartRetry: true,
            smartRetryAttempts: 3,
            lanAccess: userSettings.lanAccess === true
        };
        localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));

        // Update global reference
        window.userSettings = userSettings;

        // Apply theme and UI scale immediately
        applyTheme(userSettings.themePreset);
        applyUIScale(userSettings.uiScale);

        // Sync header speed slider with settings modal value
        const headerSpeedSlider = document.getElementById('headerSpeedSlider');
        const speedValue = document.getElementById('speedValue');
        if (headerSpeedSlider) {
            // Use non-linear mapping (same as in slider widget, min 2 MB/s)
            const speed = userSettings.maxSpeed || 0;
            let sliderVal;
            if (speed === 0) sliderVal = 0;
            else if (speed < 2000) sliderVal = 1;
            else if (speed <= 10000) sliderVal = 1 + Math.round((speed - 2000) / 100);
            else if (speed <= 100000) sliderVal = 80 + Math.round((speed - 10000) / 1125);
            else sliderVal = 160 + Math.round((speed - 100000) / 10000);
            headerSpeedSlider.value = sliderVal;
        }
        if (speedValue) {
            // Format nicely: show MB/s for values >= 1000 KB/s
            const kbps = userSettings.maxSpeed || 0;
            if (kbps === 0) {
                speedValue.textContent = '∞';
            } else if (kbps >= 1000) {
                speedValue.textContent = (kbps / 1000).toFixed(0) + ' MB/s';
            } else {
                speedValue.textContent = kbps + ' KB/s';
            }
        }

        // Handle Windows startup toggle if the setting changed
        if (newStartWithWindows !== oldStartWithWindows && window.electronAPI && window.electronAPI.toggleAutoLaunch) {
            window.electronAPI.toggleAutoLaunch(newStartWithWindows)
                .then(result => {
                    if (result.success) {
                        console.log(`Windows startup ${newStartWithWindows ? 'enabled' : 'disabled'}`);
                    } else {
                        console.error('Failed to toggle Windows startup:', result.error);
                    }
                })
                .catch(err => {
                    console.error('Error toggling Windows startup:', err);
                });
        }

        // Send updated auto-update preference to server if WebSocket is connected
        if (ws && ws.readyState === WebSocket.OPEN) {
            const autoUpdateEnabled = userSettings.autoUpdateTools !== false; // Default to true
            sendMessageToServer('auto_update_preference', { enabled: autoUpdateEnabled });
            console.log(`Updated auto-update preference: ${autoUpdateEnabled ? 'enabled' : 'disabled'}`);
        }

        // Update telemetry based on user preference
        if (window.GetVideosLocallyTelemetry) {
            if (userSettings.errorTelemetry) {
                window.GetVideosLocallyTelemetry.enable();
            } else {
                window.GetVideosLocallyTelemetry.disable();
            }
        }

        if (settingsModal) settingsModal.style.display = 'none';

        const currentStatusDiv = youtubeStatusDiv;
        if (currentStatusDiv) {
            showStatus('Settings saved!', 'youtube', 'success');
        }
        console.log("Settings saved:", userSettings);
    }

    function populateSettingsModal() {
        if (!settingsModal) return;

        setSetupHealthSectionVisibility(false);

        // Ensure checkbox is found
        if (!keepPcAwakeCheckbox) {
            keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
        }

        // If still not found, try to create it programmatically
        if (!keepPcAwakeCheckbox) {
            console.log('Creating keepPcAwake checkbox programmatically...');
            const notificationsSection = document.querySelector('.settings-section h3');
            if (notificationsSection && notificationsSection.textContent === 'Notifications') {
                const section = notificationsSection.parentElement;
                const notificationPopupDiv = section.querySelector('#notificationPopup').closest('.setting-item');

                if (notificationPopupDiv) {
                    const newCheckboxDiv = document.createElement('div');
                    newCheckboxDiv.className = 'setting-item checkbox-group';
                    newCheckboxDiv.innerHTML = `
                        <input type="checkbox" id="keepPcAwake" name="keepPcAwake">
                        <label for="keepPcAwake">Keep PC awake during downloads</label>
                    `;

                    // Insert after notificationPopup
                    notificationPopupDiv.parentNode.insertBefore(newCheckboxDiv, notificationPopupDiv.nextSibling);

                    // Update the reference
                    keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
                    console.log('Checkbox created and reference updated:', keepPcAwakeCheckbox);
                }
            }
        }

        const autoUpdateToolsCheckbox = document.getElementById('autoUpdateTools');
        if (maxSpeedInput) maxSpeedInput.value = userSettings.maxSpeed;
        if (numerateFilesCheckbox) numerateFilesCheckbox.checked = userSettings.numerateFiles;
        if (skipDuplicatesCheckbox) skipDuplicatesCheckbox.checked = userSettings.skipDuplicates;
        if (removeCompletedCheckbox) removeCompletedCheckbox.checked = userSettings.removeCompleted;
        if (notificationSoundCheckbox) notificationSoundCheckbox.checked = userSettings.notificationSound;
        if (notificationPopupCheckbox) notificationPopupCheckbox.checked = userSettings.notificationPopup;
        if (keepPcAwakeCheckbox) keepPcAwakeCheckbox.checked = userSettings.keepPcAwake;
        if (autoUpdateToolsCheckbox) autoUpdateToolsCheckbox.checked = userSettings.autoUpdateTools !== false; // Default to true
        const errorTelemetryCheckbox = document.getElementById('errorTelemetry');
        if (errorTelemetryCheckbox) errorTelemetryCheckbox.checked = userSettings.errorTelemetry === true;
        if (speedUnitDisplaySelect) speedUnitDisplaySelect.value = userSettings.speedUnitDisplay;
        if (downloadFolderInput) downloadFolderInput.value = userSettings.downloadFolder || '';
        if (skipDeleteConfirmationCheckbox) skipDeleteConfirmationCheckbox.checked = userSettings.skipDeleteConfirmation;
        if (themePresetSelect) themePresetSelect.value = userSettings.themePreset;
if (subtitleModeSelect) subtitleModeSelect.value = userSettings.subtitleMode || 'none';
        if (subtitleLanguagesInput) subtitleLanguagesInput.value = userSettings.subtitleLanguages || 'en.*,en';
if (includeAutoCaptionsCheckbox) includeAutoCaptionsCheckbox.checked = userSettings.includeAutoCaptions === true;

        // Handle Windows startup checkbox - fetch actual state from system
        const startWithWindowsCheckbox = document.getElementById('startWithWindows');
        if (startWithWindowsCheckbox) {
            // First set to saved value, then update with actual system state
            startWithWindowsCheckbox.checked = userSettings.startWithWindows === true;

            // Async update from system state (if running in Electron)
            if (window.electronAPI && window.electronAPI.getAutoLaunchStatus) {
                window.electronAPI.getAutoLaunchStatus()
                    .then(result => {
                        if (result.success) {
                            startWithWindowsCheckbox.checked = result.enabled;
                            // Sync settings with actual system state
                            if (userSettings.startWithWindows !== result.enabled) {
                                userSettings.startWithWindows = result.enabled;
                                localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
                            }
                        }
                    })
                    .catch(err => {
                        console.error('Error getting auto-launch status:', err);
                    });
            }
        }

        const lanAccessCheckbox = document.getElementById('lanAccess');
        if (lanAccessCheckbox) {
            lanAccessCheckbox.checked = userSettings.lanAccess === true;

            if (window.electronAPI && window.electronAPI.getFirewallAccessStatus) {
                window.electronAPI.getFirewallAccessStatus()
                    .then(result => {
                        if (result && result.exists !== undefined) {
                            lanAccessCheckbox.checked = result.exists;
                            userSettings.lanAccess = result.exists;
                            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
                            window.userSettings = userSettings;
                        }
                    })
                    .catch(err => {
                        console.error('Error getting firewall status:', err);
                    });
            }

            lanAccessCheckbox.onchange = async () => {
                if (!window.electronAPI) return;
                const enable = lanAccessCheckbox.checked;
                lanAccessCheckbox.disabled = true;
                try {
                    const result = enable
                        ? await window.electronAPI.enableFirewallAccess()
                        : await window.electronAPI.disableFirewallAccess();

                    if (result && result.success) {
                        userSettings.lanAccess = enable;
                        localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
                        window.userSettings = userSettings;
                    } else {
                        lanAccessCheckbox.checked = !enable;
                        if (!result?.userDenied) {
                            console.error('Firewall toggle failed:', result?.error);
                        }
                    }
                } catch (err) {
                    lanAccessCheckbox.checked = !enable;
                    console.error('Error toggling firewall rule:', err);
                } finally {
                    lanAccessCheckbox.disabled = false;
                }
            };
        }

        // Add UI scale
        const uiScaleInput = document.getElementById('uiScale');
        const uiScaleValue = document.getElementById('uiScaleValue');
        if (uiScaleInput) {
            uiScaleInput.value = userSettings.uiScale || 1.0;
            if (uiScaleValue) uiScaleValue.textContent = formatUIScaleLabel(userSettings.uiScale || 1.0);
        }

        applyUIScale(userSettings.uiScale || 1.0);

        if (latestSetupHealthResult) {
            renderSetupHealthResult(latestSetupHealthResult);
        } else {
            renderSetupHealthLoading('Run the setup health check to verify your local downloader setup.');
        }
    }

    if (settingsBtn) {
        settingsBtn.onclick = () => {
            populateSettingsModal();
            if (settingsModal) {
                openModalWithFocus(settingsModal, closeSettingsBtn || saveSettingsBtn);
            }
        };
    }
    if (closeSettingsBtn) {
        closeSettingsBtn.onclick = () => {
            if (settingsModal) {
                closeModalWithFocusRestore(settingsModal);
            }
        };
    }
    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = saveSettings;
    }

    // Subtitle mode toggle: hide languages & auto-captions when set to "none"
    function updateSubtitleVisibility() {
        const mode = subtitleModeSelect ? subtitleModeSelect.value : 'none';
        const langGroup = document.getElementById('subtitleLanguagesGroup');
        const autoGroup = document.getElementById('autoCaptionsGroup');
        if (langGroup) langGroup.classList.toggle('is-hidden-initial', mode === 'none');
        if (autoGroup) autoGroup.classList.toggle('is-hidden-initial', mode === 'none');
    }
    if (subtitleModeSelect) {
        subtitleModeSelect.addEventListener('change', updateSubtitleVisibility);
        updateSubtitleVisibility();
    }

    // Setup Guide button
    const openTutorialBtn = document.getElementById('openTutorialBtn');
    if (openTutorialBtn) {
        openTutorialBtn.onclick = () => {
            if (settingsModal) settingsModal.style.display = 'none';
            if (window.openOnboarding) {
                window.openOnboarding();
            }
        };
    }

    // Update tools button
    const updateToolsBtn = document.getElementById('updateToolsBtn');
    const updateStatusMessage = document.getElementById('updateToolsStatus');

    function showUpdateStatus(message, type) {
        if (!updateStatusMessage) return;
        if (!message) {
            updateStatusMessage.textContent = '';
            updateStatusMessage.className = 'status-message with-margin is-hidden-initial';
            updateStatusMessage.style.display = 'none';
            return;
        }
        updateStatusMessage.textContent = message;
        updateStatusMessage.className = `status-message with-margin ${type || ''}`;
        updateStatusMessage.style.display = 'flex';

        if (type === 'success') {
            setTimeout(() => {
                showUpdateStatus('', '');
            }, 5000);
        }
    }

    showUpdateStatus('', '');

    if (updateToolsBtn) {
        updateToolsBtn.onclick = async () => {
            try {
                updateToolsBtn.disabled = true;
                updateToolsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
                showUpdateStatus('Checking for updates...', '');

                const result = await window.updateTools();

                if (result && result.error) {
                    showUpdateStatus(`Error: ${result.error}`, 'error');
                    updateToolsBtn.disabled = false;
                    updateToolsBtn.innerHTML = '<i class="fas fa-download"></i> Update Tools';
                    return;
                }

                if (result) {
                    let message = '';
                    let hasUpdates = false;
                    let hasErrors = false;

                    // Check yt-dlp results
                    if (result.ytdlp) {
                        if (result.ytdlp.updated) {
                            message += `✅ yt-dlp updated: ${result.ytdlp.oldVersion} → ${result.ytdlp.newVersion}\n`;
                            hasUpdates = true;
                        } else if (result.ytdlp.error) {
                            message += `❌ yt-dlp update failed: ${result.ytdlp.error}\n`;
                            hasErrors = true;
                        } else {
                            message += `ℹ️ yt-dlp: ${result.ytdlp.reason || 'No update available'}\n`;
                        }
                    }

                    // Check FFmpeg results
                    if (result.ffmpeg) {
                        if (result.ffmpeg.hasUpdate) {
                            message += `🔄 FFmpeg update available: ${result.ffmpeg.latestVersion}\n`;
                            message += '💡 Manual download required: https://ffmpeg.org/download.html\n';
                            hasUpdates = true;
                        } else if (result.ffmpeg.error) {
                            message += `❌ FFmpeg check failed: ${result.ffmpeg.error}\n`;
                            hasErrors = true;
                        } else {
                            message += `ℹ️ FFmpeg: ${result.ffmpeg.reason || 'No update available'}\n`;
                        }
                    }

                    if (hasUpdates) {
                        showUpdateStatus(message.trim(), 'success');
                    } else if (hasErrors) {
                        showUpdateStatus(message.trim(), 'error');
                    } else {
                        showUpdateStatus(message.trim() || 'All tools are up to date.', '');
                    }
                } else {
                    showUpdateStatus('Unable to check for updates. Please try again.', 'error');
                }
            } catch (error) {
                console.error('Error updating tools:', error);
                showUpdateStatus(`Error: ${error.message || 'Failed to update tools. Please try again.'}`, 'error');
            } finally {
                updateToolsBtn.disabled = false;
                updateToolsBtn.innerHTML = '<i class="fas fa-download"></i> Update Tools';
            }
        };
    }

    // Generate diagnostics bundle button
    const generateDiagnosticsBtn = document.getElementById('generateDiagnosticsBtn');
    if (generateDiagnosticsBtn) {
        generateDiagnosticsBtn.onclick = async () => {
            try {
                generateDiagnosticsBtn.disabled = true;
                generateDiagnosticsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

                const serverPort = ws?.url?.match(/:(\d+)/)?.[1] || '9875';
                const diagnosticsUrl = `http://127.0.0.1:${serverPort}/diagnostics`;

            const response = await window.localApiAuth.authorizedFetch(diagnosticsUrl);
                if (!response.ok) {
                    throw new Error(`Failed to generate diagnostics: ${response.statusText}`);
                }

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `diagnostics-${Date.now()}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);

                showStatus('Diagnostics bundle downloaded successfully!', activeDownloader, 'success');
            } catch (error) {
                console.error('Error generating diagnostics:', error);
                showStatus(`Failed to generate diagnostics: ${error.message}`, activeDownloader, 'error');
            } finally {
                generateDiagnosticsBtn.disabled = false;
                generateDiagnosticsBtn.innerHTML = '<i class="fas fa-bug"></i> Generate Diagnostics Bundle';
            }
        };
    }

    if (dismissFailureHelpBtn) {
        dismissFailureHelpBtn.onclick = hideFailureHelp;
    }

    if (failureHelpPrimaryBtn) {
        failureHelpPrimaryBtn.onclick = () => {
            if (typeof failureHelpActionHandler === 'function') {
                failureHelpActionHandler();
            }
        };
    }

    if (runHealthCheckBtn) {
        runHealthCheckBtn.onclick = () => runSetupHealthCheck({ announce: true });
    }

    if (toggleHealthCheckBtn) {
        toggleHealthCheckBtn.onchange = async () => {
            if (!setupHealthSection) return;

            const willShow = toggleHealthCheckBtn.checked;
            setSetupHealthSectionVisibility(willShow);

            if (willShow) {
                await runSetupHealthCheck({ announce: true });
                setupHealthSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        };
    }

    // Reset speed button
    if (resetSpeedBtn) {
        resetSpeedBtn.onclick = () => {
            if (maxSpeedInput) maxSpeedInput.value = '0';
        };
    }

    window.onclick = (event) => {
        if (settingsModal && event.target === settingsModal) {
            closeModalWithFocusRestore(settingsModal);
        }
    };

    // --- Notifications ---
    function playNotificationSound() {
        if (completionSound) completionSound.play().catch(e => console.warn("Error playing notification sound:", e));
    }
    function showDesktopNotification(title, body) {
        if (!("Notification" in window)) {
            console.log("This browser does not support desktop notification");
            return;
        }
        if (Notification.permission === "granted") {
            new Notification(title, { body: body, icon: './assets/Logo 1.png' });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(function (permission) {
                if (permission === "granted") {
                    new Notification(title, { body: body, icon: './assets/Logo 1.png' });
                }
            });
        }
    }
    if (("Notification" in window) && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // --- Helper Functions ---
    function shouldSkipDeleteConfirmation() {
        return userSettings.skipDeleteConfirmation === true;
    }

    // Aceternity UI Custom Confirmation Modal
    function confirmDelete(message, title = 'Confirm Deletion') {
        if (shouldSkipDeleteConfirmation()) {
            return true;
        }

        return new Promise((resolve) => {
            const modal = document.getElementById('confirmationModal');
            const messageEl = document.getElementById('confirmationMessage');
            const titleEl = document.getElementById('confirmationTitle');
            const confirmBtn = document.getElementById('confirmationConfirmBtn');
            const cancelBtn = document.getElementById('confirmationCancelBtn');

            // Set content
            titleEl.textContent = title;
            messageEl.textContent = message;

            // Remove existing listeners
            const newConfirmBtn = confirmBtn.cloneNode(true);
            const newCancelBtn = cancelBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

            // Show modal
            openModalWithFocus(modal, newConfirmBtn);

            // Add new listeners
            newConfirmBtn.addEventListener('click', () => {
                closeModalWithFocusRestore(modal);
                resolve(true);
            });

            newCancelBtn.addEventListener('click', () => {
                closeModalWithFocusRestore(modal);
                resolve(false);
            });

            // Close on backdrop click
            modal.addEventListener('click', function backdropClick(e) {
                if (e.target === modal) {
                    closeModalWithFocusRestore(modal);
                    modal.removeEventListener('click', backdropClick);
                    resolve(false);
                }
            });

            // Close on Escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    closeModalWithFocusRestore(modal);
                    document.removeEventListener('keydown', escapeHandler);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    // Aceternity UI Custom Alert Modal
    function showAlert(message, title = 'Notification') {
        return new Promise((resolve) => {
            const modal = document.getElementById('alertModal');
            const messageEl = document.getElementById('alertMessage');
            const titleEl = document.getElementById('alertTitle');
            const okBtn = document.getElementById('alertCloseBtn');

            // Set content
            titleEl.textContent = title;
            messageEl.textContent = message;

            // Remove existing listeners
            const newOkBtn = okBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);

            // Show modal
            openModalWithFocus(modal, newOkBtn);

            // Add new listener
            newOkBtn.addEventListener('click', () => {
                closeModalWithFocusRestore(modal);
                resolve();
            });

            // Close on backdrop click
            modal.addEventListener('click', function backdropClick(e) {
                if (e.target === modal) {
                    closeModalWithFocusRestore(modal);
                    modal.removeEventListener('click', backdropClick);
                    resolve();
                }
            });

            // Close on Escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    closeModalWithFocusRestore(modal);
                    document.removeEventListener('keydown', escapeHandler);
                    resolve();
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    function markSupportPopupShownForCurrentVersion() {
        localStorage.setItem(SUPPORT_POPUP_LAST_VERSION_KEY, getCurrentAppVersion());
    }

    function hasSupportPopupBeenShownForCurrentVersion() {
        return localStorage.getItem(SUPPORT_POPUP_LAST_VERSION_KEY) === getCurrentAppVersion();
    }

    function closeSupportPopup() {
        if (!supportModal) return;
        closeModalWithFocusRestore(supportModal);
    }

    function showSupportPopupIfEligible() {
        if (!supportModal) return;
        if (userSettings.supportPopupDisabled === true) return;
        if (hasSupportPopupBeenShownForCurrentVersion()) return;

        markSupportPopupShownForCurrentVersion();
        openModalWithFocus(supportModal, supportModalDonateBtn || closeSupportModalBtn);
    }

    if (supportModal) {
        if (closeSupportModalBtn) {
            closeSupportModalBtn.addEventListener('click', closeSupportPopup);
        }

        if (supportModalDismissBtn) {
            supportModalDismissBtn.addEventListener('click', closeSupportPopup);
        }

        if (supportModalDonateBtn) {
            supportModalDonateBtn.addEventListener('click', () => {
                window.open(SUPPORT_DONATION_URL, '_blank', 'noopener,noreferrer');
                closeSupportPopup();
            });
        }

        if (supportModalNeverBtn) {
            supportModalNeverBtn.addEventListener('click', () => {
                userSettings.supportPopupDisabled = true;
                localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
                window.userSettings = userSettings;
                closeSupportPopup();
            });
        }

        supportModal.addEventListener('click', (event) => {
            if (event.target === supportModal) {
                closeSupportPopup();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && supportModal.style.display === 'flex') {
                closeSupportPopup();
            }
        });
    }

    if (playlistSelectionModal) {
        const closeSelection = () => closePlaylistSelectionFlow();
        closePlaylistSelectionBtn?.addEventListener('click', closeSelection);
        cancelPlaylistSelectionBtn?.addEventListener('click', closeSelection);
        playlistSelectAllBtn?.addEventListener('click', () => {
            playlistSelectionList?.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
                checkbox.checked = true;
            });
        });
        playlistClearSelectionBtn?.addEventListener('click', () => {
            playlistSelectionList?.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
                checkbox.checked = false;
            });
        });
        confirmPlaylistSelectionBtn?.addEventListener('click', async () => {
            if (!pendingPlaylistSelectionRequest) {
                closePlaylistSelectionFlow();
                return;
            }
            const selectedIds = getSelectedPlaylistItemIds();
            if (selectedIds.length === 0) {
                showStatus('Select at least one playlist item before queueing.', 'youtube', 'error');
                return;
            }
            const request = pendingPlaylistSelectionRequest;
            closePlaylistSelectionFlow();
            try {
                await startDownloadCommon(
                    request.url,
                    request.format,
                    request.quality,
                    request.source,
                    request.playlistAction,
                    request.concurrency,
                    request.singleConcurrency,
                    { selectedPlaylistItems: selectedIds }
                );
            } catch (error) {
                showStatus(`Could not queue selected playlist items: ${error.message}`, 'youtube', 'error');
            }
        });
        playlistSelectionModal.addEventListener('click', (event) => {
            if (event.target === playlistSelectionModal) {
                closeSelection();
            }
        });
    }

    // --- Logo Click Handler ---
    const logoContainer = document.querySelector('.logo-container');
    if (logoContainer) {
        logoContainer.style.cursor = 'pointer';
        const activateLogo = () => {
            showTab('youtube');
        };
        logoContainer.addEventListener('click', activateLogo);
        makeElementKeyboardClickable(logoContainer, activateLogo, 'Open downloads');
    }

    // --- Initializations ---
    applyTheme(userSettings.themePreset || 'light');
    applyUIScale(userSettings.uiScale || 1.0); // Add this line

    if (document.getElementById('youtubeDownloader')) {
        showTab(activeDownloader);
        void loadRecoverableDownloads();
    } else if (contactUsTab) {
        showTab('youtube');
    }

    // Ensure DOM is fully loaded before populating settings
    setTimeout(() => {
        // Re-find elements in case they weren't available initially
        if (!keepPcAwakeCheckbox) {
            keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
        }
        populateSettingsModal();

        // Final check - if checkbox still not found, log error
        if (!keepPcAwakeCheckbox) {
            console.error('Keep PC awake checkbox could not be found or created!');
            console.log('Available checkboxes:', document.querySelectorAll('input[type="checkbox"]'));
        } else {
            console.log('Keep PC awake checkbox successfully initialized:', keepPcAwakeCheckbox);
        }
    }, 100);

    // Folder picker logic
    if (chooseFolderBtn && downloadFolderInput) {
        chooseFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.openFolderDialog) {
                const folderPath = await window.electronAPI.openFolderDialog();
                if (folderPath) {
                    downloadFolderInput.value = folderPath;
                }
            } else {
                console.error('Folder picker not available. window.electronAPI:', window.electronAPI);
                showAlert('Folder picker not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }
    if (defaultFolderBtn && downloadFolderInput) {
        defaultFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
                const defaultPath = await window.electronAPI.getDefaultDownloadFolder();
                if (defaultPath) {
                    downloadFolderInput.value = defaultPath;
                }
            } else {
                console.error('Default folder not available. window.electronAPI:', window.electronAPI);
                showAlert('Default folder not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }
    if (openFolderBtn && downloadFolderInput) {
        openFolderBtn.onclick = async () => {
            const folderPath = downloadFolderInput.value;
            if (!folderPath) {
                showAlert('No folder selected.', 'No Selection');
                return;
            }
            if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                await window.electronAPI.openPathInExplorer(folderPath, folderPath);
            } else {
                console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                showAlert('Open folder not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }

    // Paste button logic
    if (pasteYoutubeUrlBtn && youtubeUrlInput) {
        pasteYoutubeUrlBtn.onclick = () => navigator.clipboard.readText().then(t => {
            youtubeUrlInput.value = t;
            // Dispatch input event to trigger playlist detection
            youtubeUrlInput.dispatchEvent(new Event('input', { bubbles: true }));
            scheduleYoutubePreview({ immediate: true, showErrors: true });
        });
    }
    // Auto-paste URL on window focus
    let lastClipboardUrl = '';

    async function checkClipboardAndPaste() {
        try {
            let clipboardText = '';
            // Use electronAPI if available, otherwise use navigator.clipboard
            if (window.electronAPI && window.electronAPI.readClipboardText) {
                clipboardText = await window.electronAPI.readClipboardText();
            } else if (navigator.clipboard && navigator.clipboard.readText) {
                clipboardText = await navigator.clipboard.readText();
            }

            if (!clipboardText) return;
            clipboardText = clipboardText.trim();

            // Check if it's a URL (any URL as requested)
            const isUrl = /^https?:\/\/.+/i.test(clipboardText);
            if (!isUrl) return;

            // Skip if we already processed this URL
            if (clipboardText === lastClipboardUrl) return;
            lastClipboardUrl = clipboardText;

            // Get the active input field based on current tab
            const activeInput = activeDownloader === 'youtube' ? youtubeUrlInput : null;

            // Only paste if the input field is empty
            if (activeInput && !activeInput.value.trim()) {
                activeInput.value = clipboardText;
                // Dispatch input event to trigger playlist detection
                activeInput.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('[Auto-paste] URL pasted from clipboard:', clipboardText);
            }
        } catch (err) {
            // Silently fail - clipboard access may be denied
            console.warn('Could not read clipboard:', err.message);
        }
    }

    // Check clipboard on window focus
    window.addEventListener('focus', checkClipboardAndPaste);

    // Also check when switching tabs
    if (youtubeTab) youtubeTab.addEventListener('click', () => setTimeout(checkClipboardAndPaste, 100));

    // Delete all buttons with confirmation
    if (clearYoutubeDownloadsBtn && youtubeDownloadLinksArea) {
        clearYoutubeDownloadsBtn.onclick = async () => {
            const confirmed = await confirmDelete('Are you sure you want to clear all YouTube downloads from the list?', 'Clear All Downloads');
            if (confirmed) {
                youtubeDownloadLinksArea.replaceChildren(emptyDownloadState, clearYoutubeDownloadsBtn);
                downloadItemsState.clear();
                updateDownloadStats();
            }
        };
    }

    // Mini-widgets DOM references
    const headerSpeedSlider = document.getElementById('headerSpeedSlider');
    const speedValue = document.getElementById('speedValue');
    const headerThemeSelect = document.getElementById('headerThemeSelect');
    const queuedCount = document.getElementById('queuedCount');
    const downloadingCount = document.getElementById('downloadingCount');
    const downloadedCount = document.getElementById('downloadedCount');

    // Update download stats widget
    function updateDownloadStats() {
        const queuedItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'queued').length;
        const downloadingItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'downloading').length;
        const completedItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'complete').length;
        const pausedItems = Array.from(downloadItemsState.values()).filter(item => item.status === 'paused').length;

        if (queuedCount) queuedCount.textContent = queuedItems;
        if (downloadingCount) downloadingCount.textContent = downloadingItems;
        if (downloadedCount) downloadedCount.textContent = completedItems;

        const totalCount = downloadItemsState.size;
        if (emptyDownloadState) {
            emptyDownloadState.style.display = totalCount === 0 ? 'flex' : 'none';
        }
        if (clearYoutubeDownloadsBtn) {
            clearYoutubeDownloadsBtn.style.display = totalCount > 0 ? 'block' : 'none';
        }

        // Calculate active downloads (queued + downloading + paused)
        const activeCount = queuedItems + downloadingItems + pausedItems;
        window.__GVL_ACTIVE_DOWNLOAD_COUNT = activeCount;

        // Update the main process for tray icon and close confirmation
        if (window.electronAPI && window.electronAPI.updateDownloadCount) {
            window.electronAPI.updateDownloadCount(activeCount).catch(err => {
                console.warn('Failed to update download count:', err);
            });
        }

        // Manage power save blocker based on active downloads
        managePowerSaveBlocker();
    }

    async function managePowerSaveBlocker() {
        if (!userSettings.keepPcAwake || !window.electronAPI) {
            console.log("Power save blocker disabled or electronAPI missing");
            return;
        }

        const activeDownloads = Array.from(downloadItemsState.values()).filter(
            item => item.status === 'downloading' || item.status === 'queued'
        ).length;

        console.log("Active downloads count:", activeDownloads);
        console.log("Power save blocker currently active:", isPowerSaveBlockerActive);

        if (activeDownloads > 0 && !isPowerSaveBlockerActive) {
            // Start power save blocker
            try {
                console.log("Attempting to start power save blocker...");
                const result = await window.electronAPI.startPowerSaveBlocker();
                console.log("Start power save blocker result:", result);

                if (result.success) {
                    isPowerSaveBlockerActive = true;
                    console.log('✅ Power save blocker activated - keeping PC awake during downloads');
                } else {
                    console.warn('⚠️ Power save blocker start returned success=false:', result.message);
                    // Even if it says "already active", update our state to match
                    isPowerSaveBlockerActive = true;
                }
            } catch (error) {
                console.error('❌ Failed to start power save blocker:', error);
            }
        } else if (activeDownloads === 0 && isPowerSaveBlockerActive) {
            // Stop power save blocker
            try {
                console.log("Attempting to stop power save blocker...");
                const result = await window.electronAPI.stopPowerSaveBlocker();
                console.log("Stop power save blocker result:", result);

                if (result.success) {
                    isPowerSaveBlockerActive = false;
                    console.log('✅ Power save blocker deactivated - PC can sleep normally');
                } else {
                    console.warn('⚠️ Power save blocker stop returned success=false:', result.message);
                    // Even if there was an issue, update our state
                    isPowerSaveBlockerActive = false;
                }
            } catch (error) {
                console.error('❌ Failed to stop power save blocker:', error);
                // Reset state on error
                isPowerSaveBlockerActive = false;
            }
        } else {
            console.log("No state change needed - Downloads:", activeDownloads, "Blocker active:", isPowerSaveBlockerActive);
        }
    }





    // Slider position → Speed mapping (minimum 2 MB/s = 2000 KB/s):
    // 0 → 0 (unlimited)
    // 1-80 → 2000-10000 KB/s (2-10 MB/s, step 100 KB/s)
    // 80-160 → 10000-100000 KB/s (10-100 MB/s, step ~1 MB/s)
    // 160-200 → 100000-500000 KB/s (100-500 MB/s, step 10 MB/s)

    function sliderToSpeed(sliderVal) {
        if (sliderVal === 0) return 0; // Unlimited
        if (sliderVal <= 80) return 2000 + (sliderVal - 1) * 100; // 2-10 MB/s
        if (sliderVal <= 160) return 10000 + (sliderVal - 80) * 1125; // 10-100 MB/s
        return 100000 + (sliderVal - 160) * 10000; // 100-500 MB/s
    }

    function speedToSlider(speed) {
        if (speed === 0) return 0;
        if (speed < 2000) return 1; // Minimum 2 MB/s
        if (speed <= 10000) return 1 + Math.round((speed - 2000) / 100);
        if (speed <= 100000) return 80 + Math.round((speed - 10000) / 1125);
        return 160 + Math.round((speed - 100000) / 10000);
    }

    // Helper to format speed for display
    function formatSpeedDisplay(kbps) {
        if (kbps === 0) return '∞';
        if (kbps >= 1000) {
            return (kbps / 1000).toFixed(0) + ' MB/s';
        }
        return kbps + ' KB/s';
    }

    if (headerSpeedSlider && speedValue) {
        // Set slider max to accommodate our mapping (200 for 500 MB/s)
        headerSpeedSlider.max = 200;
        headerSpeedSlider.step = 1;
        headerSpeedSlider.value = speedToSlider(userSettings.maxSpeed || 0);
        speedValue.textContent = formatSpeedDisplay(userSettings.maxSpeed || 0);

        headerSpeedSlider.addEventListener('input', (e) => {
            const sliderVal = parseInt(e.target.value, 10);
            const speed = sliderToSpeed(sliderVal);
            speedValue.textContent = formatSpeedDisplay(speed);
        });

        headerSpeedSlider.addEventListener('change', (e) => {
            const sliderVal = parseInt(e.target.value, 10);
            const speed = sliderToSpeed(sliderVal);
            if (maxSpeedInput) maxSpeedInput.value = speed;
            userSettings.maxSpeed = speed;
            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
            // Don't call saveSettings() here - it causes unnecessary logging
            // Settings are already saved to localStorage above
        });
    }

    // Theme Selector Widget
    if (headerThemeSelect) {
        headerThemeSelect.value = userSettings.themePreset || 'light';
        headerThemeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            if (themePresetSelect) themePresetSelect.value = theme;
            userSettings.themePreset = theme;
            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
            applyTheme(theme);
            saveSettings();
        });
    }

    // Download Badge Widget
    // function updateDownloadBadge() {
    //     const count = document.querySelectorAll('.download-item').length;
    //     if (downloadCount) downloadCount.textContent = count;
    //     if (downloadBadge) {
    //         if (count > 0) downloadBadge.classList.add('active');
    //         else downloadBadge.classList.remove('active');
    //     }
    // }
    // Call updateDownloadBadge after rendering download items
    // Example: after renderHistoryGroups, updateDownloadBadge();






    // Tool update functions
    window.checkToolsStatus = async function () {
        console.log('=== Checking Tools Status ===');
        try {
            const response = await window.localApiAuth.authorizedFetch('/tools-status');
            const status = await response.json();

            console.log('📋 Tools Status:', status);

            // Display in a nice format
            const ytdlpInfo = status.ytdlp;
            const ffmpegInfo = status.ffmpeg;

            console.log(`🎬 yt-dlp: ${ytdlpInfo.version} (last checked: ${ytdlpInfo.daysSinceLastCheck} days ago)`);
            console.log(`🎥 FFmpeg: ${ffmpegInfo.version} (last checked: ${ffmpegInfo.daysSinceLastCheck} days ago)`);

            return status;
        } catch (error) {
            console.error('❌ Error checking tools status:', error);
            return null;
        }
    };

    window.updateTools = async function () {
        console.log('=== Updating Tools ===');
        try {
            console.log('🔄 Starting tool updates...');

            const response = await window.localApiAuth.authorizedFetch('/update-tools', { method: 'POST' });
            const result = await response.json();

            console.log('📊 Update Results:', result);

            // Display results
            if (result.ytdlp) {
                if (result.ytdlp.updated) {
                    console.log(`✅ yt-dlp updated: ${result.ytdlp.oldVersion} → ${result.ytdlp.newVersion}`);
                } else {
                    console.log(`ℹ️ yt-dlp: ${result.ytdlp.reason || result.ytdlp.error || 'No update needed'}`);
                }
            }

            if (result.ffmpeg) {
                if (result.ffmpeg.hasUpdate) {
                    console.log(`🔄 FFmpeg update available: ${result.ffmpeg.latestVersion}`);
                    console.log(`💡 Note: FFmpeg requires manual download from https://ffmpeg.org/download.html`);
                } else {
                    console.log(`ℹ️ FFmpeg: ${result.ffmpeg.reason || 'No update needed'}`);
                }
            }

            if (result.error) {
                console.error('❌ Update error:', result.error);
            }

            return result;
        } catch (error) {
            console.error('❌ Error updating tools:', error);
            return null;
        }
    };

    window.forceUpdateTools = async function () {
        console.log('=== Force Updating Tools ===');
        try {
            // Clear last update check to force update
            console.log('🔄 Clearing update check timestamps...');

            // Force update by clearing timestamps (this will be handled server-side)
            const response = await window.localApiAuth.authorizedFetch('/force-update-tools', { method: 'POST' });
            const result = await response.json();

            console.log('📊 Force Update Results:', result);
            return result;
        } catch (error) {
            console.error('❌ Error force updating tools:', error);
            return null;
        }
    };









    // Fix playlist detection logic in handleWebSocketMessage and history categorization
    // ... ensure you use:
    // let subtabKey = source;
    // if (source === 'youtube') {
    //     if (currentItemState && currentItemState.isPlaylist) {
    //         subtabKey = 'youtubePlaylists';
    //     } else {
    //         subtabKey = 'youtubeSingles';
    //     }
    // }
    // ... and use the same logic when saving to history

    // After any download list change, call updateDownloadBadge()
    // For example, after adding/removing download items, call updateDownloadBadge();

    // Folder picker logic
    if (chooseFolderBtn && downloadFolderInput) {
        chooseFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.openFolderDialog) {
                const folderPath = await window.electronAPI.openFolderDialog();
                if (folderPath) {
                    downloadFolderInput.value = folderPath;
                }
            } else {
                console.error('Folder picker not available. window.electronAPI:', window.electronAPI);
                showAlert('Folder picker not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }
    if (defaultFolderBtn && downloadFolderInput) {
        defaultFolderBtn.onclick = async () => {
            if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
                const defaultPath = await window.electronAPI.getDefaultDownloadFolder();
                if (defaultPath) {
                    downloadFolderInput.value = defaultPath;
                }
            } else {
                console.error('Default folder not available. window.electronAPI:', window.electronAPI);
                showAlert('Default folder not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }
    if (openFolderBtn && downloadFolderInput) {
        openFolderBtn.onclick = async () => {
            const folderPath = downloadFolderInput.value;
            if (!folderPath) {
                showAlert('No folder selected.', 'No Selection');
                return;
            }
            if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                await window.electronAPI.openPathInExplorer(folderPath, folderPath);
            } else {
                console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                showAlert('Open folder not available. Make sure you are running in Electron.', 'Not Available');
            }
        };
    }

    const hasRunSetupHealth = Boolean(localStorage.getItem(SETUP_HEALTH_RUN_KEY));
    setSetupHealthSectionVisibility(false);
    if (hasRunSetupHealth && latestSetupHealthResult) {
        renderSetupHealthResult(latestSetupHealthResult);
    } else {
        renderSetupHealthLoading('Run the setup health check to verify your local downloader setup.');
    }

    // Add this function to handle delayed removal
    function removeDownloadItemAfterDelay(itemId) {
        setTimeout(() => {
            const itemDiv = document.getElementById(`item-${itemId}`);
            if (itemDiv) {
                itemDiv.remove();
                downloadItemsState.delete(itemId);
                updateDownloadStats();
            }
        }, 3000);
    }

    // ===== HISTORY SUB-TABS =====
    const historyTabs = document.querySelectorAll('.history-tab');
    const historyLists = {
        youtubePlaylists: document.getElementById('historyYoutubePlaylists'),
        youtubeSingles: document.getElementById('historyYoutubeSingles')
    };
    const historyEmptyState = document.getElementById('historyEmptyState');
    const emptyStateDownloadBtn = document.getElementById('emptyStateDownloadBtn');

    if (emptyStateDownloadBtn) {
        emptyStateDownloadBtn.onclick = () => {
            const youtubeTab = document.getElementById('youtubeTab');
            if (youtubeTab) youtubeTab.click();
            const urlInput = document.getElementById('youtubeUrl');
            if (urlInput) urlInput.focus();
        };
    }
    const historySummaryPrimary = document.getElementById('historySummaryPrimary');
    const historySummarySecondary = document.getElementById('historySummarySecondary');
    const historySummaryTertiary = document.getElementById('historySummaryTertiary');

    function getActiveHistoryTabKey() {
        return document.querySelector('.history-tab.active')?.dataset.history || 'youtubeSingles';
    }

    function updateHistorySummary(groupedItems) {
        const singlesCount = groupedItems.youtubeSingles?.length || 0;
        const playlistCount = groupedItems.youtubePlaylists?.length || 0;
        const playlistVideoCount = (groupedItems.youtubePlaylists || []).reduce((total, folder) => {
            return total + (folder.videos?.length || 0);
        }, 0);
        const activeTabKey = getActiveHistoryTabKey();

        if (!historySummaryPrimary || !historySummaryTertiary) return;

        if (activeTabKey === 'youtubePlaylists') {
            historySummaryPrimary.textContent = `${playlistCount} ${playlistCount === 1 ? 'playlist' : 'playlists'}`;
            historySummaryTertiary.textContent = `${playlistVideoCount} ${playlistVideoCount === 1 ? 'video total' : 'videos total'}`;
            return;
        }

        historySummaryPrimary.textContent = `${singlesCount} ${singlesCount === 1 ? 'video' : 'videos'}`;
        historySummaryTertiary.textContent = '';
    }

    function activateHistoryTab(tabKey) {
        Object.values(historyLists).forEach(list => {
            if (list) {
                list.style.display = 'none';
                list.classList.remove('active');
            }
        });
        historyTabs.forEach(btn => btn.classList.remove('active'));
        const list = historyLists[tabKey];
        const btn = document.querySelector(`.history-tab[data-history="${tabKey}"]`);
        if (list) {
            list.style.display = 'grid';
            list.classList.add('active');
        }
        if (btn) btn.classList.add('active');

        const activeItems = lastRenderedHistoryGroups?.[tabKey] || [];
        if (historyEmptyState) {
            historyEmptyState.style.display = activeItems.length === 0 ? 'flex' : 'none';
        }

        // Clear selection when switching tabs and update count
        if (bulkSelectionMode) {
            selectedHistoryItems.clear();
            // Uncheck all checkboxes in the previously visible list
            document.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked').forEach(cb => {
                cb.checked = false;
            });
            updateSelectedCount();
        }

        updateHistorySummary(lastRenderedHistoryGroups);
    }

    // History Management Variables
    let historySearchTerm = '';
    let bulkSelectionMode = false;
    let selectedHistoryItems = new Set();
    let currentTimeFilter = 'all';
    let currentSort = 'newest';
    let allHistoryItems = [];
    let lastRenderedHistoryGroups = {
        youtubePlaylists: [],
        youtubeSingles: []
    };
    let backendHistoryItems = null;
    let historyIndexHydrated = false;
    let historyIndexSyncedFromLocal = false;
    let historyIndexLoadPromise = null;
    let historyIndexSyncPromise = null;
    let historyIndexRevision = 0;

    function readStoredHistory() {
        return JSON.parse(localStorage.getItem('ytdHistory') || '[]');
    }

    async function loadHistoryIndexFromBackend(force = false) {
        if (!force && Array.isArray(backendHistoryItems)) {
            return backendHistoryItems;
        }

        if (historyIndexLoadPromise) {
            return historyIndexLoadPromise;
        }

        historyIndexLoadPromise = (async () => {
            const requestRevision = historyIndexRevision;
            try {
                const response = await window.localApiAuth.authorizedFetch(`/history-index?clientId=${encodeURIComponent(clientId)}`);
                if (!response.ok) {
                    throw new Error(`History index request failed with ${response.status}`);
                }

                const data = await response.json();
                const nextBackendItems = Array.isArray(data.items) ? data.items : [];
                if (requestRevision === historyIndexRevision || !Array.isArray(backendHistoryItems)) {
                    backendHistoryItems = nextBackendItems;
                }
                historyIndexHydrated = true;
                return Array.isArray(backendHistoryItems) ? backendHistoryItems : nextBackendItems;
            } catch (error) {
                console.debug('History index fetch fallback:', error.message);
                return null;
            } finally {
                historyIndexLoadPromise = null;
            }
        })();

        return historyIndexLoadPromise;
    }

    async function syncHistoryIndexToBackend(historyItems = readStoredHistory(), revision = historyIndexRevision) {
        try {
            const response = await window.localApiAuth.authorizedFetch('/history-index/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    clientId,
                    history: historyItems
                })
            });

            if (!response.ok) {
                throw new Error(`History sync failed with ${response.status}`);
            }

            const data = await response.json();
            const nextBackendItems = Array.isArray(data.items) ? data.items : historyItems;
            if (revision === historyIndexRevision) {
                backendHistoryItems = nextBackendItems;
                historyIndexHydrated = true;
            }
            historyIndexHydrated = true;
            historyIndexSyncedFromLocal = true;
            return Array.isArray(backendHistoryItems) ? backendHistoryItems : nextBackendItems;
        } catch (error) {
            console.debug('History index sync fallback:', error.message);
            return historyItems;
        }
    }

    function queueHistoryIndexSync(historyItems = readStoredHistory(), revision = historyIndexRevision) {
        historyIndexSyncPromise = syncHistoryIndexToBackend(historyItems, revision)
            .catch(() => historyItems)
            .finally(() => {
                historyIndexSyncPromise = null;
            });

        return historyIndexSyncPromise;
    }

    function persistStoredHistory(historyItems, { refresh = true } = {}) {
        const nextHistory = Array.isArray(historyItems) ? historyItems.slice(0, 500) : [];
        historyIndexRevision += 1;
        localStorage.setItem('ytdHistory', JSON.stringify(nextHistory));
        backendHistoryItems = nextHistory.slice();
        historyIndexHydrated = true;
        queueHistoryIndexSync(nextHistory, historyIndexRevision);
        if (refresh) {
            filterAndRenderHistory();
        }
        return nextHistory;
    }

    async function getHistorySourceItems() {
        const localHistory = readStoredHistory();
        const backendItems = await loadHistoryIndexFromBackend();

        if ((!Array.isArray(backendItems) || backendItems.length === 0) && localHistory.length > 0 && !historyIndexSyncedFromLocal) {
            await syncHistoryIndexToBackend(localHistory);
        }

        if (Array.isArray(backendHistoryItems) && backendHistoryItems.length > 0) {
            return backendHistoryItems;
        }

        return localHistory;
    }

    // Performance: Debounce function
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Performance: Throttle function
    function throttle(func, limit) {
        let inThrottle;
        return function (...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // Debounced history filter for better performance
    const debouncedFilterHistory = debounce(() => {
        filterAndRenderHistory();
    }, 300);

    // History Search and Filter Functions
    function setupHistoryManagement() {
        const historySearchInput = document.getElementById('historySearch');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        const timeFilter = document.getElementById('timeFilter');
        const sortBy = document.getElementById('sortBy');
        const bulkSelectBtn = document.getElementById('bulkSelectBtn');

        if (historySearchInput) {
            historySearchInput.addEventListener('input', (e) => {
                historySearchTerm = e.target.value.toLowerCase().trim();
                debouncedFilterHistory();
            });
            historySearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    historySearchInput.value = '';
                    historySearchTerm = '';
                    filterAndRenderHistory();
                }
            });
        }
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (historySearchInput) historySearchInput.value = '';
                historySearchTerm = '';
                filterAndRenderHistory();
            });
        }
        if (timeFilter) {
            timeFilter.addEventListener('change', (e) => {
                currentTimeFilter = e.target.value;
                filterAndRenderHistory();
            });
        }
        if (sortBy) {
            sortBy.addEventListener('change', (e) => {
                currentSort = e.target.value;
                filterAndRenderHistory();
            });
        }
        if (bulkSelectBtn) {
            bulkSelectBtn.addEventListener('click', toggleBulkSelectionMode);
        }
        setupBulkActionButtons();
    }

    function filterHistoryByTime(items) {
        if (currentTimeFilter === 'all') return items;
        const now = new Date();
        const cutoffTime = new Date();
        switch (currentTimeFilter) {
            case 'today':
                cutoffTime.setHours(0, 0, 0, 0);
                break;
            case 'week':
                cutoffTime.setDate(now.getDate() - 7);
                break;
            case 'month':
                cutoffTime.setDate(now.getDate() - 30);
                break;
            default:
                return items;
        }
        return items.filter(item => {
            const itemDate = new Date(item.mtime);
            return itemDate >= cutoffTime;
        });
    }

    function filterHistoryBySearch(items) {
        if (!historySearchTerm) return items;
        return items.filter(item => {
            const title = item.name.toLowerCase();
            const meta = new Date(item.mtime).toLocaleString().toLowerCase();
            return title.includes(historySearchTerm) || meta.includes(historySearchTerm);
        });
    }

    function sortHistoryItems(items) {
        const sorted = [...items];
        switch (currentSort) {
            case 'newest':
                return sorted.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
            case 'oldest':
                return sorted.sort((a, b) => new Date(a.mtime) - new Date(b.mtime));
            case 'name':
                return sorted.sort((a, b) => a.name.localeCompare(b.name));
            case 'size':
                return sorted.sort((a, b) => {
                    const sizeA = parseFloat(a.size) || 0;
                    const sizeB = parseFloat(b.size) || 0;
                    return sizeB - sizeA;
                });
            default:
                return sorted;
        }
    }

    async function filterAndRenderHistory() {
        const allHistory = await getHistorySourceItems();

        // Filter by clientId to make history computer-specific
        // (Backward compatibility: show items that have no clientId, as they likely belong to this machine)
        let filteredItems = allHistory.filter(item => !item.clientId || item.clientId === clientId);

        filteredItems = filterHistoryByTime(filteredItems);
        filteredItems = filterHistoryBySearch(filteredItems);
        filteredItems = sortHistoryItems(filteredItems);

        // Group playlist items by playlistId for folder display
        const playlistGroups = new Map();
        const singleItems = [];

        for (const item of filteredItems) {
            if (item.isPlaylistItem && item.playlistId) {
                // Group playlist items together
                if (!playlistGroups.has(item.playlistId)) {
                    playlistGroups.set(item.playlistId, {
                        isFolder: true,
                        name: item.playlistTitle || 'Playlist',
                        playlistId: item.playlistId,
                        folder: item.folder,
                        mtime: item.mtime,
                        videos: []
                    });
                }
                playlistGroups.get(item.playlistId).videos.push(item);
            } else if (item.type === 'youtubePlaylists' && !item.isPlaylistItem) {
                // Legacy playlist items without grouping info  
                singleItems.push(item);
            } else {
                singleItems.push(item);
            }
        }

        // Convert playlist groups to array
        const playlistFolders = Array.from(playlistGroups.values());

        const groupedItems = {
            youtubePlaylists: playlistFolders,
            youtubeSingles: singleItems.filter(item => item.type === 'youtubeSingles' || item.type === 'youtube')
        };

        lastRenderedHistoryGroups = groupedItems;
        renderHistoryGroups(groupedItems);
        updateHistorySummary(groupedItems);
        updateItemCount(filteredItems.length);
    }

    async function renderHistoryGroups(groupedItems) {
        const rootFolder = getDownloadFolder();
        Object.values(historyLists).forEach(list => {
            if (list) list.innerHTML = '';
        });

        const totalItems = Object.values(groupedItems).reduce((sum, items) => sum + items.length, 0);
        const activeTabKey = getActiveHistoryTabKey();
        const activeTabItems = groupedItems[activeTabKey]?.length || 0;
        if (historyEmptyState) {
            historyEmptyState.style.display = activeTabItems === 0 ? 'flex' : 'none';
        }

        for (const [type, items] of Object.entries(groupedItems)) {
            const list = historyLists[type];
            if (!list) continue;
            for (const [index, item] of items.entries()) {
                // Check if this is a folder (playlist folder)
                if (item.isFolder && item.videos && item.videos.length > 0) {
                    const folderElement = await createFolderElement(item, index, rootFolder);
                    if (folderElement) {
                        list.appendChild(folderElement);
                    }
                } else {
                    const historyItem = await createHistoryItemElement(item, index, rootFolder);
                    if (historyItem) {
                        list.appendChild(historyItem);
                    }
                }
            }
        }
        if (bulkSelectionMode) {
            applyBulkMode();
        }
        updateDownloadStats(); // Update download badge after rendering history groups
    }

    async function createHistoryItemElement(item, index, rootFolder) {
        try {
            let absPath;

            // Priority: use fullPath if available (most reliable), otherwise resolve from path
            if (item.fullPath) {
                absPath = item.fullPath;
            } else {
                const itemFolder = item.folder || rootFolder;
                if (item.path.startsWith('/downloads/')) {
                    let relativePath = decodeURIComponent(item.path.replace('/downloads/', ''));
                    // If relativePath is already absolute, use it directly
                    const isAbsolute = /^[a-zA-Z]:[\\\/]/.test(relativePath) || relativePath.startsWith('/');
                    if (isAbsolute) {
                        absPath = relativePath;
                    } else if (window.electronAPI?.resolvePath) {
                        absPath = await window.electronAPI.resolvePath(itemFolder, relativePath);
                    } else {
                        absPath = itemFolder + '\\' + relativePath.replace(/\//g, '\\');
                    }
                } else if (item.path.startsWith('http')) {
                    return null;
                } else {
                    absPath = item.path;
                }
            }

            let fileExists = true;
            if (window.electronAPI?.pathExists) {
                fileExists = await window.electronAPI.pathExists(absPath);
            }

            let thumbnailSrc = item.thumbnail || LOCAL_THUMBNAIL_PLACEHOLDER;

            const div = document.createElement('div');
            div.className = 'history-item';
            div.dataset.index = index;
            div.dataset.originalIndex = findOriginalIndex(item);
            if (!fileExists) {
                div.classList.add('file-missing');
            }
            div.innerHTML = `
                    <img class="history-thumb" src="${thumbnailSrc}" alt="Thumbnail" loading="lazy">
                    <div style="flex: 1; min-width: 0;">
                        <div class="history-title" title="${item.name.replace(/"/g, '&quot;')}">${item.name}${!fileExists ? ' (Missing)' : ''}</div>
                        <div class="history-meta">${new Date(item.mtime).toLocaleString()} • ${item.size}</div>
              </div>
              <div class="history-actions">
                        <button class="history-action-btn play" title="Play Video" data-action="play" data-path="${absPath}" data-index="${index}" ${!fileExists ? 'disabled' : ''}>
                  <i class="fas fa-play"></i>
                </button>
                        <button class="history-action-btn folder" title="Open Folder" data-action="folder" data-path="${absPath}" data-index="${index}">
                  <i class="fas fa-folder-open"></i>
                </button>
                        <button class="history-action-btn delete" title="Delete File" data-action="delete" data-path="${absPath}" data-index="${index}">
                  <i class="fas fa-trash"></i>
                </button>
              </div>`;
            const historyThumb = div.querySelector('.history-thumb');
            if (historyThumb) {
                historyThumb.addEventListener('error', () => {
                    historyThumb.src = LOCAL_THUMBNAIL_PLACEHOLDER;
                }, { once: true });
            }
            return div;
        } catch (error) {
            console.error(`Error creating history item element:`, error);
            return null;
        }
    }

    async function createFolderElement(folderItem, index, rootFolder) {
        try {
            const folderPath = folderItem.path || folderItem.folder;
            let absPath = folderPath;

            // Resolve absolute path if needed
            if (folderPath && window.electronAPI?.resolvePath) {
                // Check if path is relative (doesn't start with drive letter or /)
                const isRelative = !/^[a-zA-Z]:[\\/]/.test(folderPath) && !folderPath.startsWith('/');
                if (isRelative) {
                    absPath = await window.electronAPI.resolvePath(rootFolder, folderPath);
                } else {
                    absPath = folderPath;
                }
            }

            let folderExists = true;
            if (window.electronAPI?.pathExists) {
                folderExists = await window.electronAPI.pathExists(absPath);
            }

            const folderDiv = document.createElement('div');
            folderDiv.className = 'history-folder';
            folderDiv.dataset.index = index;
            folderDiv.dataset.folderPath = absPath;
            folderDiv.dataset.expanded = 'false';
            folderDiv.dataset.originalIndex = findOriginalIndex(folderItem);
            folderDiv.dataset.playlistId = folderItem.playlistId; // Store playlistId for folder deletion

            const videoCount = folderItem.videoCount || (folderItem.videos ? folderItem.videos.length : 0);
            const folderName = folderItem.name || 'Playlist Folder';

            folderDiv.innerHTML = `
                <div class="history-folder-header">
                    <button class="history-folder-toggle" style="background: none; border: none; padding: 4px 8px; cursor: pointer; margin-right: 8px; color: var(--text-color);">
                        <i class="fas fa-chevron-right" style="transition: transform 0.2s;"></i>
                    </button>
                    <i class="fas fa-folder" style="margin-right: 8px; color: #4a90e2;"></i>
                    <div style="flex: 1; min-width: 0;">
                        <div class="history-title" style="font-weight: 600;">${folderName}</div>
                        <div class="history-meta">${new Date(folderItem.mtime).toLocaleString()} • ${folderItem.size} • ${videoCount} video${videoCount !== 1 ? 's' : ''}</div>
                    </div>
                </div>
                <div class="history-folder-content">
                    <!-- Videos will be inserted here when expanded -->
                </div>
            `;

            // Make the entire folder div a card with proper styling
            folderDiv.style.cssText = `
                background: var(--card-bg);
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                margin-bottom: 12px;
                overflow: hidden;
                grid-column: 1 / -1;
                border: 1px solid var(--border-color);
            `;

            // Style the header
            const header = folderDiv.querySelector('.history-folder-header');
            header.style.cssText = `
                display: flex;
                align-items: center;
                padding: 20px 24px;
                cursor: pointer;
                background: var(--input-bg);
                border-bottom: 1px solid var(--border-color);
                transition: background-color 0.2s;
                gap: 20px;
            `;
            header.setAttribute('aria-expanded', 'false');
            header.addEventListener('mouseenter', () => { header.style.background = 'var(--hover-bg, rgba(155, 17, 30, 0.05))'; });
            header.addEventListener('mouseleave', () => { header.style.background = 'var(--input-bg)'; });

            // Larger folder icon
            const folderIcon = header.querySelector('.fa-folder');
            if (folderIcon) {
                folderIcon.className = 'fas fa-folder';
                folderIcon.style.cssText = `
                    font-size: 28px;
                    color: #4a90e2;
                    background: rgba(74, 144, 226, 0.1);
                    padding: 12px;
                    border-radius: 12px;
                    min-width: 52px;
                    text-align: center;
                `;
            }

            // Refine title and meta
            const titleEl = header.querySelector('.history-title');
            if (titleEl) {
                titleEl.parentElement.style.flex = '1';
                titleEl.style.fontSize = '1.15rem';
                titleEl.style.fontWeight = '600';
                titleEl.style.marginBottom = '6px';
                titleEl.style.color = 'var(--text-color)';
                titleEl.parentElement.style.display = 'flex';
                titleEl.parentElement.style.flexDirection = 'column';
                titleEl.parentElement.style.justifyContent = 'center';
            }

            // Meta styling
            const metaEl = header.querySelector('.history-date');
            if (metaEl) {
                metaEl.style.fontSize = '0.9rem';
                metaEl.style.color = 'var(--text-muted, #7f8c8d)';
            }

            // Style the content container
            const contentDiv = folderDiv.querySelector('.history-folder-content');
            contentDiv.style.cssText = `
                display: none;
                padding: 12px;
                background: var(--card-bg);
                border-top: 1px solid var(--border-color);
                flex-direction: column;
                gap: 8px;
            `;

            const toggleExpansion = async (e) => {
                // Don't toggle expansion if in bulk mode or if clicking checkbox
                if (bulkSelectionMode || e.target.type === 'checkbox') {
                    return;
                }
                e.stopPropagation(); // Prevent bubbling if needed

                const isExpanded = folderDiv.dataset.expanded === 'true';

                if (!isExpanded && contentDiv.children.length === 0) {
                    // Load videos when first expanded
                    if (folderItem.videos && folderItem.videos.length > 0) {
                        for (let i = 0; i < folderItem.videos.length; i++) {
                            const video = folderItem.videos[i];
                            // Pass rootFolder to correctly resolve paths if needed
                            const videoElement = await createHistoryItemElement(video, `${index}_${i}`, rootFolder);
                            if (videoElement) {
                                videoElement.style.marginLeft = '0';
                                videoElement.style.width = '100%';
                                videoElement.style.marginBottom = '6px';
                                contentDiv.appendChild(videoElement);
                            }
                        }
                        // Remove margin from last item
                        if (contentDiv.lastElementChild) {
                            contentDiv.lastElementChild.style.marginBottom = '0';
                        }
                    }
                }

                folderDiv.dataset.expanded = isExpanded ? 'false' : 'true';
                contentDiv.style.display = isExpanded ? 'none' : 'block';
                header.setAttribute('aria-expanded', String(!isExpanded));

                const chevron = folderDiv.querySelector('.history-folder-toggle i');
                if (chevron) {
                    chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(90deg)';
                }
            };

            // Toggle on click of the toggle button OR the header
            const toggleBtn = folderDiv.querySelector('.history-folder-toggle');
            if (toggleBtn) {
                toggleBtn.setAttribute('aria-label', `Toggle ${folderName}`);
                toggleBtn.addEventListener('click', toggleExpansion);
            }
            header.addEventListener('click', toggleExpansion);
            makeElementKeyboardClickable(header, () => toggleExpansion({
                target: header,
                stopPropagation() { }
            }), `Toggle ${folderName}`);


            if (!folderExists) {
                folderDiv.classList.add('file-missing');
            }

            return folderDiv;
        } catch (error) {
            console.error(`Error creating folder element:`, error);
            return null;
        }
    }

    function findOriginalIndex(targetItem) {
        const allHistory = readStoredHistory();
        if (targetItem.isFolder) {
            // For folders, find the first playlist item that belongs to this folder
            // Folders don't exist in history, but their playlist items do
            return allHistory.findIndex(item =>
                item.isPlaylistItem &&
                item.playlistId === targetItem.playlistId &&
                item.folder === targetItem.folder
            );
        } else {
            // Match regular items by name, mtime, and path
            return allHistory.findIndex(item =>
                item.name === targetItem.name &&
                item.mtime === targetItem.mtime &&
                item.path === targetItem.path
            );
        }
    }

    function updateItemCount(count) {
        const itemCountEl = document.getElementById('itemCount');
        if (itemCountEl) {
            itemCountEl.textContent = `${count} item${count !== 1 ? 's' : ''}`;
        }
    }

    // Bulk Selection Functions
    function toggleBulkSelectionMode() {
        bulkSelectionMode = !bulkSelectionMode;
        const bulkActionsDiv = document.getElementById('historyBulkActions');
        const bulkSelectBtn = document.getElementById('bulkSelectBtn');
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        if (bulkSelectionMode) {
            if (bulkActionsDiv) bulkActionsDiv.style.display = 'flex';
            if (bulkSelectBtn) {
                bulkSelectBtn.innerHTML = '<i class="fas fa-times"></i> Exit Bulk';
                bulkSelectBtn.classList.add('danger-btn');
            }
            if (clearHistoryBtn) clearHistoryBtn.style.display = 'none';
            applyBulkMode();
        } else {
            if (bulkActionsDiv) bulkActionsDiv.style.display = 'none';
            if (bulkSelectBtn) {
                bulkSelectBtn.innerHTML = '<i class="fas fa-check-square"></i> Bulk Select';
                bulkSelectBtn.classList.remove('danger-btn');
            }
            if (clearHistoryBtn) clearHistoryBtn.style.display = '';
            removeBulkMode();
        }
    }

    function applyBulkMode() {
        selectedHistoryItems.clear();
        document.querySelectorAll('.history-item').forEach((item) => {
            item.classList.add('bulk-mode');
            const existingCheckbox = item.querySelector('.history-item-checkbox');
            if (existingCheckbox) existingCheckbox.remove();

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'history-item-checkbox';
            checkbox.dataset.originalIndex = item.dataset.originalIndex;
            checkbox.addEventListener('change', handleHistoryItemSelection);

            // Prevent checkbox click from triggering item click twice if bubbling issues arise, 
            // but relying on the item click handler is cleaner for the user experience.
            checkbox.addEventListener('click', (e) => e.stopPropagation());

            item.appendChild(checkbox);

            // Add click listener to the container for selection
            item.addEventListener('click', handleItemContainerClick);

            // Disable all action buttons in the item
            const itemButtons = item.querySelectorAll('button');
            itemButtons.forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
            });
        });
        // Apply bulk mode to folder elements
        document.querySelectorAll('.history-folder').forEach((folder) => {
            folder.classList.add('bulk-mode');
            const existingCheckbox = folder.querySelector('.history-folder-checkbox');
            if (existingCheckbox) existingCheckbox.remove();

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'history-folder-checkbox';
            checkbox.dataset.originalIndex = folder.dataset.originalIndex;
            checkbox.addEventListener('change', handleFolderSelection);

            checkbox.addEventListener('click', (e) => e.stopPropagation());

            // Insert checkbox at the beginning of the folder header
            const header = folder.querySelector('.history-folder-header');
            if (header) {
                header.insertBefore(checkbox, header.firstChild);

                // Add click handler to folder header for selection in bulk mode
                const folderHeaderClickHandler = (e) => {
                    // Only handle selection if bulk mode is active
                    if (!bulkSelectionMode) {
                        return; // Don't interfere if bulk mode is off
                    }
                    // Don't trigger selection if clicking the checkbox, toggle button, or action buttons
                    if (e.target === checkbox || e.target.type === 'checkbox' || e.target.closest('.history-folder-toggle') || e.target.closest('.history-action-btn')) {
                        return;
                    }
                    // Toggle checkbox state
                    e.stopPropagation(); // Prevent toggleExpansion from firing
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                };
                // Use capture phase to fire before toggleExpansion
                header.addEventListener('click', folderHeaderClickHandler, true);
                // Store handler reference on the header for potential cleanup
                header._bulkModeClickHandler = folderHeaderClickHandler;
            }

            // Disable all action buttons in the folder (especially the folder open button)
            const folderButtons = folder.querySelectorAll('.history-action-btn');
            folderButtons.forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
            });

            // Disable folder toggle during bulk mode
            const toggleBtn = folder.querySelector('.history-folder-toggle');
            if (toggleBtn) {
                toggleBtn.disabled = true;
                toggleBtn.style.opacity = '0.5';
                toggleBtn.style.pointerEvents = 'none';
            }
        });
        updateSelectedCount();
        updateSelectAllButtonState(false);
    }

    function removeBulkMode() {
        document.querySelectorAll('.history-item').forEach((item) => {
            item.classList.remove('bulk-mode');
            item.classList.remove('selected'); // Remove selected state
            const checkbox = item.querySelector('.history-item-checkbox');
            if (checkbox) checkbox.remove();

            // Remove click listener
            item.removeEventListener('click', handleItemContainerClick);

            // Re-enable action buttons
            const itemButtons = item.querySelectorAll('button');
            itemButtons.forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            });
        });
        // Remove bulk mode from folder elements
        document.querySelectorAll('.history-folder').forEach((folder) => {
            folder.classList.remove('bulk-mode');
            folder.classList.remove('selected'); // Remove selected state
            const checkbox = folder.querySelector('.history-folder-checkbox');
            if (checkbox) checkbox.remove();

            // Remove the bulk mode click handler if it exists
            const header = folder.querySelector('.history-folder-header');
            if (header && header._bulkModeClickHandler) {
                header.removeEventListener('click', header._bulkModeClickHandler, true);
                delete header._bulkModeClickHandler;
            }

            // Re-enable action buttons
            const folderButtons = folder.querySelectorAll('.history-action-btn');
            folderButtons.forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            });

            // Re-enable folder toggle
            const toggleBtn = folder.querySelector('.history-folder-toggle');
            if (toggleBtn) {
                toggleBtn.disabled = false;
                toggleBtn.style.opacity = '1';
                toggleBtn.style.pointerEvents = 'auto';
            }
        });
        selectedHistoryItems.clear();
        updateSelectedCount();
    }

    // Handler for clicking the history item container in bulk mode
    function handleItemContainerClick(e) {
        // Find the checkbox within this item
        const checkbox = this.querySelector('.history-item-checkbox');
        if (checkbox) {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        }
    }

    // Duplicate removeBulkMode removed

    function handleHistoryItemSelection(e) {
        const item = e.target.closest('.history-item');
        const originalIndex = parseInt(e.target.dataset.originalIndex);
        if (e.target.checked) {
            selectedHistoryItems.add(originalIndex);
            item.classList.add('selected');
        } else {
            selectedHistoryItems.delete(originalIndex);
            item.classList.remove('selected');
        }
        updateSelectedCount();
    }

    function handleFolderSelection(e) {
        const folder = e.target.closest('.history-folder');
        const originalIndex = parseInt(e.target.dataset.originalIndex);
        if (originalIndex >= 0) { // Only proceed if we found a valid index
            if (e.target.checked) {
                selectedHistoryItems.add(originalIndex);
                folder.classList.add('selected');
            } else {
                selectedHistoryItems.delete(originalIndex);
                folder.classList.remove('selected');
            }
            updateSelectedCount();
        }
    }

    function updateSelectedCount() {
        const countSpan = document.getElementById('selectedCount');
        if (countSpan) {
            // Only count checkboxes that are in the currently active/visible history list
            const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
            let visibleCheckboxes = [];
            if (activeList) {
                visibleCheckboxes = activeList.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked');
            } else {
                // Fallback: find the visible list
                const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                    list.style.display !== 'none' && list.style.display !== ''
                );
                if (visibleList) {
                    visibleCheckboxes = visibleList.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked');
                }
            }
            const count = visibleCheckboxes.length;
            countSpan.textContent = `${count} selected`;
        }
        // Update Select All button state - only checkboxes in the active tab
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let checkboxes = [];
        if (activeList) {
            checkboxes = Array.from(activeList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                checkboxes = Array.from(visibleList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
            }
        }
        if (checkboxes.length > 0) {
            const allChecked = checkboxes.every(cb => cb.checked);
            updateSelectAllButtonState(allChecked);
        }
    }

    function setupBulkActionButtons() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('#selectAllHistoryBtn')) {
                toggleSelectAll();
            } else if (e.target.closest('#deleteSelectedBtn')) {
                deleteSelectedItems();
            } else if (e.target.closest('#cancelSelectionBtn')) {
                toggleBulkSelectionMode();
            }
        });
    }

    function toggleSelectAll() {
        // Only work with checkboxes in the currently active/visible history list
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let checkboxes = [];
        if (activeList) {
            checkboxes = Array.from(activeList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                checkboxes = Array.from(visibleList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
            }
        }
        const allChecked = checkboxes.length > 0 && checkboxes.every(cb => cb.checked);

        if (allChecked) {
            // Deselect all
            deselectAllItems();
        } else {
            // Select all
            selectAllItems();
        }
    }

    function updateSelectAllButtonState(allSelected) {
        const selectAllBtn = document.getElementById('selectAllHistoryBtn');
        if (!selectAllBtn) return;

        const icon = selectAllBtn.querySelector('i');
        if (allSelected) {
            selectAllBtn.innerHTML = '<i class="fas fa-square"></i> Deselect All';
        } else {
            selectAllBtn.innerHTML = '<i class="fas fa-check-square"></i> Select All';
        }
    }

    function selectAllItems() {
        // Only select checkboxes in the currently active/visible history list
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let checkboxes = [];
        if (activeList) {
            checkboxes = Array.from(activeList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                checkboxes = Array.from(visibleList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
            }
        }
        checkboxes.forEach(cb => {
            if (!cb.checked) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change'));
            }
        });
        updateSelectAllButtonState(true);
    }

    // Clear History Logic with 3-button modal
    function setupClearHistoryButton() {
        const clearBtn = document.getElementById('clearHistoryBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                const activeTabBtn = document.querySelector('.history-tab.active');
                if (!activeTabBtn) return;

                const type = activeTabBtn.dataset.history;
                let typeLabel = 'Video Singles';
                if (type === 'youtubePlaylists') typeLabel = 'Video Playlists';

                // Show custom 3-button modal
                const result = await showClearHistoryModal(typeLabel);

                if (result === 'cancel') return;

                let history = readStoredHistory();

                if (result === 'clearAll') {
                    // Clear all history
                    persistStoredHistory([]);
                    showNotification('All history cleared.', 'success');
                } else if (result === 'clearTab') {
                    // Clear only current tab - filter out items that belong to current tab
                    history = history.filter(item => {
                        if (type === 'youtubePlaylists') {
                            // Keep everything that's NOT a playlist item or folder
                            return !(item.isPlaylistItem && item.playlistId) && !item.isFolder;
                        } else {
                            // youtubeSingles - keep if it's a playlist item or folder
                            const isPlaylist = (item.isPlaylistItem && item.playlistId) || item.isFolder;
                            return isPlaylist;
                        }
                    });
                    persistStoredHistory(history);
                    showNotification(`${typeLabel} history cleared.`, 'success');
                }
            });
        }
    }

    // Custom 3-button clear history modal
    function showClearHistoryModal(tabName) {
        return new Promise((resolve) => {
            // Remove existing modal if any
            const existing = document.getElementById('clearHistoryModal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.id = 'clearHistoryModal';
            modal.className = 'modal';
            modal.style.cssText = `
                display: flex;
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                z-index: 9999;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
            `;

            modal.innerHTML = `
                <div class="modal-content close-confirmation-modal" style="padding: 2rem;">
                    <div class="confirmation-icon" style="box-shadow: 0 0 20px rgba(239, 68, 68, 0.35);">
                        <i class="fas fa-trash-alt"></i>
                    </div>
                    <h2 style="margin: 0 0 0.5rem;">Clear History</h2>
                    <p style="color: var(--text-color); opacity: 0.8; margin-bottom: 1.75rem; line-height: 1.5; font-size: 0.95rem;">
                        What would you like to clear?<br>
                        <small style="opacity: 0.7;">This action cannot be undone.</small>
                    </p>
                    <div class="close-actions-grid">
                        <button id="clearTabBtn" class="action-btn primary-btn-glow">
                            <i class="fas fa-folder-minus"></i>
                            <div>
                                <span class="btn-title">Clear ${tabName}</span>
                                <span class="btn-desc">Remove ${tabName.toLowerCase()} only</span>
                            </div>
                        </button>
                        <button id="clearAllBtn" class="action-btn danger-btn-outline">
                            <i class="fas fa-trash"></i>
                            <div>
                                <span class="btn-title">Clear All</span>
                                <span class="btn-desc">Remove entire history</span>
                            </div>
                        </button>
                    </div>
                    <div class="close-cancel-row">
                        <button id="cancelClearBtn" class="text-btn">Cancel</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Button handlers
            modal.querySelector('#clearTabBtn').onclick = () => {
                modal.remove();
                resolve('clearTab');
            };
            modal.querySelector('#clearAllBtn').onclick = () => {
                modal.remove();
                resolve('clearAll');
            };
            modal.querySelector('#cancelClearBtn').onclick = () => {
                modal.remove();
                resolve('cancel');
            };

            // Close on backdrop click
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve('cancel');
                }
            };

            // Close on Escape
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escHandler);
                    resolve('cancel');
                }
            };
            document.addEventListener('keydown', escHandler);
        });
    }

    /**
     * Shows a premium-grade toast notification.
     * @param {string} message - The message to display.
     * @param {'info' | 'success' | 'error' | 'warning'} type - The type of notification.
     */
    function showNotification(message, type = 'info') {
        const existing = document.querySelector('.notification-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `notification-toast toast-${type}`;

        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';
        if (type === 'warning') icon = 'exclamation-triangle';

        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas fa-${icon} toast-icon"></i>
                <div class="toast-message">${message}</div>
            </div>
            <div class="toast-progress"></div>
        `;
        document.body.appendChild(toast);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }



    // Call setup
    setupClearHistoryButton();

    function deselectAllItems() {
        // Only deselect checkboxes in the currently active/visible history list
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let checkboxes = [];
        if (activeList) {
            checkboxes = Array.from(activeList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                checkboxes = Array.from(visibleList.querySelectorAll('.history-item-checkbox, .history-folder-checkbox'));
            }
        }
        checkboxes.forEach(cb => {
            if (cb.checked) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });
        updateSelectAllButtonState(false);
    }

    async function deleteSelectedItems() {
        // Get selected items from the currently active/visible history list
        const activeList = document.querySelector('.history-list.active, .history-list[style*="grid"]');
        let visibleCheckedItems = [];
        if (activeList) {
            visibleCheckedItems = Array.from(activeList.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked'));
        } else {
            const visibleList = Array.from(document.querySelectorAll('.history-list')).find(list =>
                list.style.display !== 'none' && list.style.display !== ''
            );
            if (visibleList) {
                visibleCheckedItems = Array.from(visibleList.querySelectorAll('.history-item-checkbox:checked, .history-folder-checkbox:checked'));
            }
        }

        if (visibleCheckedItems.length === 0) {
            await showAlert('No items selected for deletion.', 'No Selection');
            return;
        }

        // Get the original indices from the checked items
        const indicesToDelete = visibleCheckedItems.map(cb => parseInt(cb.dataset.originalIndex)).filter(idx => idx >= 0);

        const confirmMessage = `Delete ${indicesToDelete.length} selected item${indicesToDelete.length !== 1 ? 's' : ''} permanently?`;
        const confirmed = await confirmDelete(confirmMessage, 'Delete Selected Items');
        if (!confirmed) return;

        const history = readStoredHistory();
        const sortedIndicesToDelete = indicesToDelete.sort((a, b) => b - a);
        let deletedCount = 0;
        let removedCount = 0;

        // First, collect all items to delete
        // Distinguish between folder selections (delete entire folder) and individual item selections (delete only selected items)
        const itemsToDelete = new Map(); // Map<index, item>
        const folderPlaylistIds = new Set(); // Track playlist IDs for folders that were explicitly selected via folder checkbox

        // Check which checkboxes were selected - folder checkboxes vs individual item checkboxes
        const selectedFolderCheckboxes = visibleCheckedItems.filter(cb => cb.classList.contains('history-folder-checkbox'));
        const selectedItemCheckboxes = visibleCheckedItems.filter(cb => cb.classList.contains('history-item-checkbox'));

        // If folder checkboxes are selected, mark those playlist IDs for full folder deletion
        for (const folderCb of selectedFolderCheckboxes) {
            const index = parseInt(folderCb.dataset.originalIndex);
            if (index >= 0 && index < history.length) {
                const item = history[index];
                if (item && item.playlistId) {
                    folderPlaylistIds.add(item.playlistId);
                }
            }
        }

        // Add all selected items to deletion map
        for (const index of sortedIndicesToDelete) {
            if (index >= 0 && index < history.length) {
                const item = history[index];
                if (item) {
                    itemsToDelete.set(index, item);
                }
            }
        }

        // For folders that were explicitly selected (via folder checkbox), find all playlist items with the same playlistId
        // Only do this for folders that were selected via folder checkbox, not for individual items
        if (folderPlaylistIds.size > 0) {
            for (let i = 0; i < history.length; i++) {
                const item = history[i];
                if (item && item.isPlaylistItem && item.playlistId && folderPlaylistIds.has(item.playlistId)) {
                    // Add all items from this folder to deletion
                    if (!itemsToDelete.has(i)) {
                        itemsToDelete.set(i, item);
                    }
                }
            }
        }

        // Sort indices in descending order for safe deletion
        const sortedIndices = Array.from(itemsToDelete.keys()).sort((a, b) => b - a);

        // Get folder paths to delete (only delete folders if the entire folder was selected)
        // Only delete folders if they were selected via folder checkbox, not if only individual items were selected
        const foldersToDelete = new Set();
        for (const index of sortedIndices) {
            const item = itemsToDelete.get(index);
            // Only delete the folder if this playlistId was in folderPlaylistIds (meaning folder checkbox was selected)
            if (item && item.isPlaylistItem && item.playlistId && item.folder && folderPlaylistIds.has(item.playlistId)) {
                // Store the folder path for deletion (we'll resolve it properly)
                foldersToDelete.add(item.folder);
            }
        }

        // Delete folders first
        const rootFolder = getDownloadFolder();
        for (const folderPath of foldersToDelete) {
            try {
                let absPath = folderPath;
                if (folderPath && window.electronAPI?.resolvePath) {
                    // Check if path is relative
                    const isRelative = !/^[a-zA-Z]:[\\/]/.test(folderPath) && !folderPath.startsWith('/');
                    if (isRelative) {
                        absPath = await window.electronAPI.resolvePath(rootFolder, folderPath);
                    }
                }
                if (absPath && window.electronAPI?.deleteFolder) {
                    await window.electronAPI.deleteFolder(rootFolder, absPath);
                    deletedCount++;
                }
            } catch (error) {
                console.error(`Failed to delete folder ${folderPath}:`, error);
            }
        }

        // Delete individual files and remove from history
        for (const index of sortedIndices) {
            const item = itemsToDelete.get(index);
            if (item) {
                try {
                    // If this item is part of a folder that was fully deleted (folder checkbox selected),
                    // skip individual file deletion as the folder was already deleted
                    // Otherwise, delete the individual file
                    const isPartOfDeletedFolder = item.isPlaylistItem && item.playlistId && folderPlaylistIds.has(item.playlistId);
                    if (!isPartOfDeletedFolder) {
                        // Delete individual file
                        if (window.electronAPI?.deleteFile) {
                            let absPath;
                            if (item.path && item.path.startsWith('/downloads/')) {
                                const relativePath = decodeURIComponent(item.path.replace('/downloads/', ''));
                                absPath = await window.electronAPI.resolvePath(rootFolder, relativePath);
                            } else if (item.path) {
                                absPath = item.path;
                            } else if (item.fullPath) {
                                absPath = item.fullPath;
                            }
                            if (absPath) {
                                const result = await window.electronAPI.deleteFile(rootFolder, absPath);
                                if (result.success) deletedCount++;
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Failed to delete file for item ${index}:`, error);
                }
            }
            // Remove from history
            history.splice(index, 1);
            removedCount++;
        }
        persistStoredHistory(history, { refresh: false });
        selectedHistoryItems.clear();
        toggleBulkSelectionMode();
        filterAndRenderHistory();
        const message = deletedCount > 0
            ? `Successfully deleted ${deletedCount} item${deletedCount !== 1 ? 's' : ''} and removed ${removedCount} item${removedCount !== 1 ? 's' : ''} from history.`
            : `Removed ${removedCount} item${removedCount !== 1 ? 's' : ''} from history.`;
        await showAlert(message, 'Deletion Complete');
    }

    // clearHistoryBtn is now handled by setupClearHistoryButton() with 3-button modal

    // History action buttons event listener
    document.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('.history-action-btn');
        if (!actionBtn) return;

        const action = actionBtn.dataset.action;
        const filePath = actionBtn.dataset.path;
        const index = parseInt(actionBtn.dataset.index);

        if (action === 'play') {
            if (window.electronAPI?.openPathInExplorer) {
                await window.electronAPI.openPathInExplorer(getDownloadFolder(), filePath);
            }
        } else if (action === 'folder') {
            if (window.electronAPI?.getDirname && window.electronAPI?.openPathInExplorer) {
                const folderPath = await window.electronAPI.getDirname(filePath);
                await window.electronAPI.openPathInExplorer(getDownloadFolder(), folderPath);
            }
        } else if (action === 'delete') {
            const confirmed = await confirmDelete('Are you sure you want to delete this file?', 'Delete File');
            if (confirmed) {
                try {
                    if (window.electronAPI?.deleteFile) {
                        const result = await window.electronAPI.deleteFile(getDownloadFolder(), filePath);
                        if (result.success) {
                            // Remove from history
                            const history = readStoredHistory();
                            const historyItem = actionBtn.closest('.history-item');
                            const originalIndex = parseInt(historyItem.dataset.originalIndex);
                            if (originalIndex >= 0 && originalIndex < history.length) {
                                history.splice(originalIndex, 1);
                                persistStoredHistory(history);
                            }
                        } else {
                            await showAlert('Failed to delete file: ' + (result.error || 'Unknown error'), 'Deletion Failed');
                        }
                    }
                } catch (error) {
                    console.error('Error deleting file:', error);
                    await showAlert('Error deleting file: ' + error.message, 'Error');
                }
            }
        }
    });

    // Wire the history tabs
    historyTabs.forEach(btn =>
        btn.addEventListener('click', () => {
            activateHistoryTab(btn.dataset.history);
            filterAndRenderHistory();
        })
    );

    // Initial history setup
    activateHistoryTab('youtubeSingles');
    setupHistoryManagement();
    filterAndRenderHistory();

    async function scanDownloadFolderAndUpdateHistory() {
        if (!window.electronAPI || !window.electronAPI.listDownloadFolder) return;
        const folder = getDownloadFolder();
        const files = await window.electronAPI.listDownloadFolder(folder);
    }

    function renderFromLocalStorage() {
        filterAndRenderHistory();
    }

    if (downloadFolderInput) {
        downloadFolderInput.addEventListener('change', scanDownloadFolderAndUpdateHistory);
    }

    scanDownloadFolderAndUpdateHistory();

    // UI Scale slider event listener
    const uiScaleInput = document.getElementById('uiScale');
    const uiScaleValue = document.getElementById('uiScaleValue');

    if (uiScaleInput && uiScaleValue) {
        uiScaleInput.addEventListener('input', (e) => {
            const scaleValue = parseFloat(e.target.value);
            uiScaleValue.textContent = formatUIScaleLabel(scaleValue);
            applyUIScale(scaleValue);
        });

        uiScaleInput.addEventListener('change', (e) => {
            const scaleValue = clampNumber(parseFloat(e.target.value), UI_SCALE_MIN, UI_SCALE_MAX);
            e.target.value = scaleValue;
            userSettings.uiScale = scaleValue;
            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
            uiScaleValue.textContent = formatUIScaleLabel(scaleValue);
        });
    }

    // ===== ONBOARDING WIZARD SYSTEM =====
    initOnboarding();

    // ===== UPDATE CHECK SYSTEM =====
    initUpdateCheck();

    // ===== SCROLL TO TOP BUTTON =====

    // ===== UPDATE CHECK & CHANGELOG SYSTEM =====
const UPDATE_LAST_SEEN_KEY = 'gvl_lastSeenVersion';
const UPDATE_POPUP_DELAY_MS = 2500;
const DEFAULT_APP_VERSION = '3.0.2';
const FALLBACK_APP_CHANGELOG = {
    version: DEFAULT_APP_VERSION,
    title: "Security Patches v3.0.2",
    date: 'May 2026',
    required: true,
    badge: 'Required',
    summary: 'Required security patches for local file handling, FFmpeg update integrity, and firewall access controls.',
    items: [
        { icon: 'fa-compass', color: '#3498db', title: 'New Onboarding Experience', desc: 'The old tutorial modal was replaced with a guided setup flow for download location, format, and notifications.' },
        { icon: 'fa-sliders', color: '#2ecc71', title: 'Cleaner Download Controls', desc: 'Advanced download controls are now tucked away until needed, keeping the main download form focused.' },
        { icon: 'fa-gear', color: '#e74c3c', title: 'Smarter Settings Layout', desc: 'Settings were reorganized, subtitle fields now appear only when relevant, and controls are easier to scan.' },
        { icon: 'fa-clock-rotate-left', color: '#f39c12', title: 'History & Safety Improvements', desc: 'History actions, labels, and bulk controls were refined to reduce accidental clicks and make video lists clearer.' },
        { icon: 'fa-shield-halved', color: '#16a085', title: 'Required Security Patches', desc: 'Local file actions are restricted to the downloads folder, deletions use the Recycle Bin, and FFmpeg updates are verified against a shipped checksum manifest.' }
    ]
};
let updatePopupTimer = null;

function getCurrentAppVersion() {
    const rawVersion = typeof window.APP_VERSION === 'string' ? window.APP_VERSION.trim() : '';
    return rawVersion || DEFAULT_APP_VERSION;
}

function getValidAppChangelog() {
    const changelog = window.APP_CHANGELOG || FALLBACK_APP_CHANGELOG;
    if (!changelog || !Array.isArray(changelog.items) || changelog.items.length === 0) {
        return FALLBACK_APP_CHANGELOG;
    }

    const normalizedItems = changelog.items
        .filter(item => item && typeof item === 'object')
        .map((item) => ({
            icon: String(item.icon || 'fa-circle-info'),
            color: String(item.color || '#3498db'),
            title: String(item.title || 'Update'),
            desc: String(item.desc || 'Latest improvements are now available.')
        }));

    return {
        version: String(changelog.version || getCurrentAppVersion()),
        title: String(changelog.title || `What's New in v${getCurrentAppVersion()}`),
        date: String(changelog.date || ''),
        required: changelog.required === true,
        badge: String(changelog.badge || ''),
        summary: String(changelog.summary || ''),
        items: normalizedItems.length > 0 ? normalizedItems : FALLBACK_APP_CHANGELOG.items
    };
}

function showLatestChangesPopup(options = {}) {
    const immediate = options.immediate === true;
    const force = options.force === true;
    const version = getCurrentAppVersion();
    const lastSeen = localStorage.getItem(UPDATE_LAST_SEEN_KEY);

    if (!force && lastSeen === version) {
        return false;
    }

    const changelog = getValidAppChangelog();
    window.clearTimeout(updatePopupTimer);

    const openPopup = () => showUpdatePopup(changelog, version, UPDATE_LAST_SEEN_KEY);
    if (immediate) {
        openPopup();
    } else {
        updatePopupTimer = window.setTimeout(openPopup, UPDATE_POPUP_DELAY_MS);
    }

    return true;
}

function initUpdateCheck() {
    showLatestChangesPopup();
}

window.resetLastSeenVersion = function resetLastSeenVersion() {
    localStorage.removeItem(UPDATE_LAST_SEEN_KEY);
    const currentValue = localStorage.getItem(UPDATE_LAST_SEEN_KEY);
    console.log(`[UpdateCheck] ${UPDATE_LAST_SEEN_KEY} reset. Current value:`, currentValue);
    return currentValue;
};

window.showLatestChangesPopup = function showLatestChangesPopupFromConsole() {
    const shown = showLatestChangesPopup({ immediate: true, force: true });
    console.log(`[UpdateCheck] Forced popup trigger result: ${shown ? 'shown' : 'skipped'}`);
    return shown;
};

function showUpdatePopup(changelog, version, storageKey) {
    const modal = document.getElementById('updateModal');
    const content = document.getElementById('updateContent');
    if (!modal || !content) return;

    const itemsHtml = changelog.items.map(item => `
        <div class="update-item">
            <div class="update-item-icon" style="background: ${item.color}15; color: ${item.color};">
                <i class="fas ${item.icon}"></i>
            </div>
            <div class="update-item-text">
                <div class="update-item-title">${item.title}</div>
                <div class="update-item-desc">${item.desc}</div>
            </div>
        </div>
    `).join('');
    const requiredBadgeHtml = changelog.required
        ? `<span class="update-required-badge">${changelog.badge || 'Required'}</span>`
        : '';
    const summaryHtml = changelog.summary
        ? `<p class="onboarding-step-subtitle update-summary">${changelog.summary}</p>`
        : `<p class="onboarding-step-subtitle">You've been updated to version ${version}. Here's what's new.</p>`;

    content.innerHTML = `
        <div class="onboarding-progress-bar">
            <div class="onboarding-progress-fill" style="width: 100%; background: linear-gradient(90deg, #2ecc71, #27ae60);"></div>
        </div>
        <div class="onboarding-scroll-area">
            <div class="onboarding-step-view">
                <div class="onboarding-success-icon" style="background: linear-gradient(135deg, #9b59b6, #8e44ad);">
                    <i class="fas fa-arrow-up-from-bracket"></i>
                </div>
                <div class="update-title-row">
                    <h2 class="onboarding-step-title">${changelog.title}</h2>
                    ${requiredBadgeHtml}
                </div>
                ${summaryHtml}
                <div class="update-items-list">
                    ${itemsHtml}
                </div>
            </div>
        </div>
        <div class="onboarding-nav-bar">
            <div class="onboarding-nav-info">v${version}</div>
            <div class="onboarding-nav-actions">
                <button class="onboarding-btn primary" id="updateDismissBtn">Got it</button>
            </div>
        </div>
    `;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    modal.onclick = (e) => {
        if (e.target === modal) dismissUpdate(modal, storageKey, version);
    };

    document.getElementById('updateDismissBtn')?.addEventListener('click', () => {
        dismissUpdate(modal, storageKey, version);
    });

    document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            dismissUpdate(modal, storageKey, version);
            document.removeEventListener('keydown', handler);
        }
    });
}

function dismissUpdate(modal, storageKey, version) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
    localStorage.setItem(storageKey, version);
}

// ===== SCROLL TO TOP BUTTON =====
    initScrollToTop();
});

function initScrollToTop() {
    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    if (!scrollToTopBtn) return;

    // Show/hide button based on scroll position
    function toggleScrollButton() {
        if (window.pageYOffset > 300) {
            scrollToTopBtn.classList.add('show');
        } else {
            scrollToTopBtn.classList.remove('show');
        }
    }

    // Scroll to top when button is clicked
    scrollToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // Listen for scroll events
    window.addEventListener('scroll', toggleScrollButton);

    // Initial check
    toggleScrollButton();
}

// Onboarding Wizard System
function initOnboarding() {
    const modal = document.getElementById('onboardingModal');
    const content = document.getElementById('onboardingContent');

    if (!modal || !content) return;

    let currentStep = 0;

    const onboardingState = {
        downloadFolder: '',
        format: 'mp4',
        quality: 'highest',
        notifications: { sound: true, desktop: false }
    };

    const TOTAL_STEPS = 5;

    const steps = [
        { id: 'welcome' },
        { id: 'location' },
        { id: 'format' },
        { id: 'notifications' },
        { id: 'complete' }
    ];

    function flashHighlight(element, duration = 1500) {
        if (!element) return;
        element.classList.add('onboarding-flash-highlight');
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
            element.classList.remove('onboarding-flash-highlight');
        }, duration);
    }

    function getFolderDisplay() {
        const input = document.getElementById('downloadFolder');
        if (input && input.value) {
            onboardingState.downloadFolder = input.value;
            return input.value;
        }
        const saved = localStorage.getItem('downloadFolder');
        if (saved) {
            onboardingState.downloadFolder = saved;
            return saved;
        }
        return 'Downloads folder';
    }

    function shortenPath(path, maxLen = 45) {
        if (!path || path.length <= maxLen) return path;
        return '...' + path.slice(-(maxLen - 3));
    }

    function renderWelcome() {
        return `
            <div class="onboarding-progress-bar">
                <div class="onboarding-progress-fill" style="width: 20%"></div>
            </div>
            <div class="onboarding-step-indicators">
                ${steps.map((_, i) => `<div class="onboarding-step-dot ${i === 0 ? 'active' : ''}" data-step="${i}"></div>`).join('')}
            </div>
            <div class="onboarding-scroll-area">
                <div class="onboarding-step-view">
                    <div class="onboarding-welcome-icon">
                        <i class="fas fa-play"></i>
                    </div>
                    <h2 class="onboarding-step-title">Welcome to GetVideosLocally</h2>
                    <p class="onboarding-step-subtitle">Download videos and audio from 1,000+ supported sites. Fast, private, and entirely on your computer.</p>
                    <div class="onboarding-features">
                        <div class="onboarding-feature-card">
                            <div class="onboarding-feature-icon"><i class="fas fa-bolt"></i></div>
                            <div class="onboarding-feature-text">Fast downloads with yt-dlp & FFmpeg</div>
                        </div>
                        <div class="onboarding-feature-card">
                            <div class="onboarding-feature-icon"><i class="fas fa-shield-halved"></i></div>
                            <div class="onboarding-feature-text">100% local &mdash; nothing leaves your machine</div>
                        </div>
                        <div class="onboarding-feature-card">
                            <div class="onboarding-feature-icon"><i class="fas fa-music"></i></div>
                            <div class="onboarding-feature-text">Video (MP4, MKV) &amp; audio (MP3, FLAC)</div>
                        </div>
                        <div class="onboarding-feature-card">
                            <div class="onboarding-feature-icon"><i class="fas fa-list"></i></div>
                            <div class="onboarding-feature-text">Full playlist support with batch download</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="onboarding-nav-bar">
                <div class="onboarding-nav-info">Step 1 of ${TOTAL_STEPS}</div>
                <div class="onboarding-nav-actions">
                    <button class="onboarding-btn ghost" data-action="skip">Skip setup</button>
                    <button class="onboarding-btn primary" data-action="next">Get Started <i class="fas fa-arrow-right"></i></button>
                </div>
            </div>
        `;
    }

    function renderLocation() {
        const currentFolder = getFolderDisplay();
        const shortFolder = shortenPath(currentFolder);
        return `
            <div class="onboarding-progress-bar">
                <div class="onboarding-progress-fill" style="width: 40%"></div>
            </div>
            <div class="onboarding-step-indicators">
                ${steps.map((_, i) => `<div class="onboarding-step-dot ${i === 1 ? 'active' : ''} ${i < 1 ? 'completed' : ''}" data-step="${i}"></div>`).join('')}
            </div>
            <div class="onboarding-scroll-area">
                <div class="onboarding-step-view">
                    <div class="onboarding-welcome-icon" style="background: linear-gradient(135deg, #3498db, #2980b9);">
                        <i class="fas fa-folder-open"></i>
                    </div>
                    <h2 class="onboarding-step-title">Where should we save your downloads?</h2>
                    <p class="onboarding-step-subtitle">Choose a folder on your computer. You can always change this later in Settings.</p>
                    <div class="onboarding-form">
                        <div class="onboarding-form-group">
                            <label for="onboardingFolder">Download location</label>
                            <div class="onboarding-folder-row">
                                <input type="text" id="onboardingFolder" class="input-field" readonly value="${shortFolder}" />
                                <button class="action-btn" id="onboardingChooseFolder" type="button" style="height:44px">
                                    <i class="fas fa-folder-open"></i> Choose
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="onboarding-tip">
                        <i class="fas fa-lightbulb"></i>
                        <span>We'll create the folder for you if it doesn't exist yet.</span>
                    </div>
                </div>
            </div>
            <div class="onboarding-nav-bar">
                <div class="onboarding-nav-info">Step 2 of ${TOTAL_STEPS}</div>
                <div class="onboarding-nav-actions">
                    <button class="onboarding-btn outline" data-action="prev"><i class="fas fa-arrow-left"></i> Back</button>
                    <button class="onboarding-btn primary" data-action="next">Continue <i class="fas fa-arrow-right"></i></button>
                </div>
            </div>
        `;
    }

    function renderFormat() {
        const currentFormat = document.getElementById('format')?.value || onboardingState.format;
        return `
            <div class="onboarding-progress-bar">
                <div class="onboarding-progress-fill" style="width: 60%"></div>
            </div>
            <div class="onboarding-step-indicators">
                ${steps.map((_, i) => `<div class="onboarding-step-dot ${i === 2 ? 'active' : ''} ${i < 2 ? 'completed' : ''}" data-step="${i}"></div>`).join('')}
            </div>
            <div class="onboarding-scroll-area">
                <div class="onboarding-step-view">
                    <div class="onboarding-welcome-icon" style="background: linear-gradient(135deg, #9b59b6, #8e44ad);">
                        <i class="fas fa-sliders"></i>
                    </div>
                    <h2 class="onboarding-step-title">What do you download most?</h2>
                    <p class="onboarding-step-subtitle">Pick your go-to format. You can switch anytime.</p>
                    <div class="onboarding-choices" id="onboardingFormatChoices">
                        <div class="onboarding-choice-card ${currentFormat === 'mp4' ? 'selected' : ''}" data-format="mp4">
                            <div class="onboarding-choice-icon"><i class="fas fa-film"></i></div>
                            <div class="onboarding-choice-label">MP4 Video</div>
                            <div class="onboarding-choice-desc">Best for video, widely compatible</div>
                        </div>
                        <div class="onboarding-choice-card ${currentFormat === 'mp3' ? 'selected' : ''}" data-format="mp3">
                            <div class="onboarding-choice-icon"><i class="fas fa-music"></i></div>
                            <div class="onboarding-choice-label">MP3 Audio</div>
                            <div class="onboarding-choice-desc">Music & podcasts</div>
                        </div>
                        <div class="onboarding-choice-card ${currentFormat === 'mkv' ? 'selected' : ''}" data-format="mkv">
                            <div class="onboarding-choice-icon"><i class="fas fa-file-video"></i></div>
                            <div class="onboarding-choice-label">MKV Video</div>
                            <div class="onboarding-choice-desc">Open format, multi-track</div>
                        </div>
                        <div class="onboarding-choice-card ${currentFormat === 'flac' ? 'selected' : ''}" data-format="flac">
                            <div class="onboarding-choice-icon"><i class="fas fa-headphones"></i></div>
                            <div class="onboarding-choice-label">FLAC Audio</div>
                            <div class="onboarding-choice-desc">Lossless quality, bigger files</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="onboarding-nav-bar">
                <div class="onboarding-nav-info">Step 3 of ${TOTAL_STEPS}</div>
                <div class="onboarding-nav-actions">
                    <button class="onboarding-btn outline" data-action="prev"><i class="fas fa-arrow-left"></i> Back</button>
                    <button class="onboarding-btn primary" data-action="next">Continue <i class="fas fa-arrow-right"></i></button>
                </div>
            </div>
        `;
    }

    function renderNotifications() {
        const soundEnabled = document.getElementById('notificationSound')?.checked ?? onboardingState.notifications.sound;
        const desktopEnabled = document.getElementById('notificationPopup')?.checked ?? onboardingState.notifications.desktop;
        return `
            <div class="onboarding-progress-bar">
                <div class="onboarding-progress-fill" style="width: 80%"></div>
            </div>
            <div class="onboarding-step-indicators">
                ${steps.map((_, i) => `<div class="onboarding-step-dot ${i === 3 ? 'active' : ''} ${i < 3 ? 'completed' : ''}" data-step="${i}"></div>`).join('')}
            </div>
            <div class="onboarding-scroll-area">
                <div class="onboarding-step-view">
                    <div class="onboarding-welcome-icon" style="background: linear-gradient(135deg, #f39c12, #e67e22);">
                        <i class="fas fa-bell"></i>
                    </div>
                    <h2 class="onboarding-step-title">Stay in the loop</h2>
                    <p class="onboarding-step-subtitle">Get notified when your downloads finish. You can adjust these any time in Settings.</p>
                    <div class="onboarding-toggle-list">
                        <div class="onboarding-toggle-row">
                            <div class="onboarding-toggle-info">
                                <div class="onboarding-toggle-icon"><i class="fas fa-volume-high"></i></div>
                                <div class="onboarding-toggle-text">
                                    <div class="onboarding-toggle-label">Sound alerts</div>
                                    <div class="onboarding-toggle-desc">Play a sound when downloads complete</div>
                                </div>
                            </div>
                            <label class="onboarding-toggle-switch">
                                <input type="checkbox" id="onboardingSoundToggle" ${soundEnabled ? 'checked' : ''}>
                                <span class="onboarding-toggle-slider"></span>
                            </label>
                        </div>
                        <div class="onboarding-toggle-row">
                            <div class="onboarding-toggle-info">
                                <div class="onboarding-toggle-icon"><i class="fas fa-desktop"></i></div>
                                <div class="onboarding-toggle-text">
                                    <div class="onboarding-toggle-label">Desktop notifications</div>
                                    <div class="onboarding-toggle-desc">Show system notifications when done</div>
                                </div>
                            </div>
                            <label class="onboarding-toggle-switch">
                                <input type="checkbox" id="onboardingDesktopToggle" ${desktopEnabled ? 'checked' : ''}>
                                <span class="onboarding-toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                    <p class="onboarding-skip-label">You can change these later in Settings</p>
                </div>
            </div>
            <div class="onboarding-nav-bar">
                <div class="onboarding-nav-info">Step 4 of ${TOTAL_STEPS}</div>
                <div class="onboarding-nav-actions">
                    <button class="onboarding-btn outline" data-action="prev"><i class="fas fa-arrow-left"></i> Back</button>
                    <button class="onboarding-btn primary" data-action="next">Continue <i class="fas fa-arrow-right"></i></button>
                </div>
            </div>
        `;
    }

    function renderComplete() {
        const formatLabels = { mp4: 'MP4 Video', mp3: 'MP3 Audio', mkv: 'MKV Video', flac: 'FLAC Audio', wav: 'WAV Audio', m4a: 'M4A Audio', opus: 'Opus Audio', webm: 'WEBM Video', mov: 'MOV Video' };
        const formatLabel = formatLabels[onboardingState.format] || onboardingState.format.toUpperCase();
        const folder = shortenPath(onboardingState.downloadFolder || getFolderDisplay(), 35);
        const soundOn = document.getElementById('onboardingSoundToggle')?.checked ?? onboardingState.notifications.sound;
        const desktopOn = document.getElementById('onboardingDesktopToggle')?.checked ?? onboardingState.notifications.desktop;
        return `
            <div class="onboarding-progress-bar">
                <div class="onboarding-progress-fill" style="width: 100%"></div>
            </div>
            <div class="onboarding-step-indicators">
                ${steps.map((_, i) => `<div class="onboarding-step-dot completed" data-step="${i}"></div>`).join('')}
            </div>
            <div class="onboarding-scroll-area">
                <div class="onboarding-step-view">
                    <div class="onboarding-success-icon">
                        <i class="fas fa-check"></i>
                    </div>
                    <h2 class="onboarding-step-title">You're all set!</h2>
                    <p class="onboarding-step-subtitle">Your preferences are saved. Paste a video URL to start your first download.</p>
                    <div class="onboarding-summary">
                        <div class="onboarding-summary-item">
                            <span class="onboarding-summary-icon"><i class="fas fa-check"></i></span>
                            <span class="onboarding-summary-label">Download folder</span>
                            <span class="onboarding-summary-value">${folder}</span>
                        </div>
                        <div class="onboarding-summary-item">
                            <span class="onboarding-summary-icon"><i class="fas fa-check"></i></span>
                            <span class="onboarding-summary-label">Default format</span>
                            <span class="onboarding-summary-value">${formatLabel}</span>
                        </div>
                        <div class="onboarding-summary-item">
                            <span class="onboarding-summary-icon"><i class="fas fa-check"></i></span>
                            <span class="onboarding-summary-label">Sound alerts</span>
                            <span class="onboarding-summary-value">${soundOn ? 'On' : 'Off'}</span>
                        </div>
                        <div class="onboarding-summary-item">
                            <span class="onboarding-summary-icon"><i class="fas fa-check"></i></span>
                            <span class="onboarding-summary-label">Desktop notifications</span>
                            <span class="onboarding-summary-value">${desktopOn ? 'On' : 'Off'}</span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="onboarding-nav-bar">
                <div class="onboarding-nav-info">All done</div>
                <div class="onboarding-nav-actions">
                    <button class="onboarding-btn success" data-action="finish"><i class="fas fa-download"></i> Start Downloading</button>
                </div>
            </div>
        `;
    }

    function renderStep(index) {
        const renderers = [renderWelcome, renderLocation, renderFormat, renderNotifications, renderComplete];
        content.innerHTML = renderers[index]();
        attachStepListeners(index);
    }

    function applyLocationChoice() {
        const folderInput = document.getElementById('onboardingFolder');
        if (folderInput && folderInput.value && !folderInput.value.includes('...')) {
            onboardingState.downloadFolder = folderInput.value;
        } else {
            onboardingState.downloadFolder = getFolderDisplay();
        }
    }

    function applyFormatChoice() {
        const selected = document.querySelector('.onboarding-choice-card.selected');
        if (selected) {
            const format = selected.dataset.format;
            onboardingState.format = format;
            const formatSelect = document.getElementById('format');
            if (formatSelect) {
                formatSelect.value = format;
                formatSelect.dispatchEvent(new Event('change'));
            }
        }
    }

    function applyNotificationChoices() {
        const soundToggle = document.getElementById('onboardingSoundToggle');
        const desktopToggle = document.getElementById('onboardingDesktopToggle');

        if (soundToggle) {
            onboardingState.notifications.sound = soundToggle.checked;
            const el = document.getElementById('notificationSound');
            if (el) el.checked = soundToggle.checked;
        }
        if (desktopToggle) {
            onboardingState.notifications.desktop = desktopToggle.checked;
            const el = document.getElementById('notificationPopup');
            if (el) el.checked = desktopToggle.checked;
        }
    }

    function attachStepListeners(index) {
        content.querySelector('[data-action="next"]')?.addEventListener('click', () => {
            if (index === 1) applyLocationChoice();
            if (index === 2) applyFormatChoice();
            if (index === 3) applyNotificationChoices();
            if (index < TOTAL_STEPS - 1) {
                currentStep++;
                renderStep(currentStep);
            }
        });

        content.querySelector('[data-action="prev"]')?.addEventListener('click', () => {
            if (index > 0) {
                currentStep--;
                renderStep(currentStep);
            }
        });

        content.querySelector('[data-action="skip"]')?.addEventListener('click', closeModal);

        content.querySelector('[data-action="finish"]')?.addEventListener('click', () => {
            closeModal();
            setTimeout(() => {
                const urlInput = document.getElementById('youtubeUrl');
                if (urlInput) {
                    flashHighlight(urlInput);
                    urlInput.focus();
                }
            }, 300);
        });

        content.querySelector('.onboarding-close-btn')?.addEventListener('click', closeModal);

        if (index === 1) {
            document.getElementById('onboardingChooseFolder')?.addEventListener('click', async () => {
                if (window.electronAPI && window.electronAPI.openFolderDialog) {
                    try {
                        const folderPath = await window.electronAPI.openFolderDialog();
                        if (folderPath) {
                            const folder = folderPath.replace(/\\/g, '/');
                            onboardingState.downloadFolder = folder;
                            const folderInput = document.getElementById('onboardingFolder');
                            if (folderInput) folderInput.value = shortenPath(folder);
                            const mainFolderInput = document.getElementById('downloadFolder');
                            if (mainFolderInput) {
                                mainFolderInput.value = folder;
                                localStorage.setItem('downloadFolder', folder);
                            }
                        }
                    } catch (e) {
                        console.error('Folder selection cancelled or failed:', e);
                    }
                } else {
                    const settingsBtn = document.getElementById('settingsBtn');
                    const settingsModal = document.getElementById('settingsModal');
                    if (settingsBtn && settingsModal) {
                        closeModal();
                        settingsModal.style.display = 'flex';
                        document.body.classList.add('modal-open');
                        setTimeout(() => flashHighlight(settingsBtn), 300);
                    }
                }
            });
        }

        if (index === 2) {
            content.querySelectorAll('.onboarding-choice-card').forEach(card => {
                card.addEventListener('click', () => {
                    content.querySelectorAll('.onboarding-choice-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    onboardingState.format = card.dataset.format;
                });
            });
        }

        if (index === 3) {
            const soundToggle = document.getElementById('onboardingSoundToggle');
            const desktopToggle = document.getElementById('onboardingDesktopToggle');
            if (soundToggle) soundToggle.addEventListener('change', () => {
                onboardingState.notifications.sound = soundToggle.checked;
            });
            if (desktopToggle) desktopToggle.addEventListener('change', () => {
                onboardingState.notifications.desktop = desktopToggle.checked;
            });
        }

        content.querySelectorAll('.onboarding-step-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                const targetStep = parseInt(dot.dataset.step);
                if (!isNaN(targetStep) && targetStep < currentStep) {
                    currentStep = targetStep;
                    renderStep(currentStep);
                }
            });
        });

        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };
    }

    function openModal() {
        currentStep = 0;
        renderStep(currentStep);
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) settingsModal.style.display = 'none';
    }

    function closeModal() {
        modal.style.display = 'none';
        document.body.style.overflow = '';
        localStorage.setItem('ytdTutorialCompleted', 'true');
        applyNotificationChoices();
    }

    window.openOnboarding = openModal;

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });

    const onboardingCompleted = localStorage.getItem('ytdTutorialCompleted');
    if (!onboardingCompleted) {
        setTimeout(() => openModal(), 1000);
    }
}


// Ensure default download folder is set correctly on first launch
window.addEventListener('DOMContentLoaded', async () => {
    const downloadFolderInput = document.getElementById('downloadFolder');

    // Get the app's downloads folder (for first startup) and user's Downloads folder (for default button)
    let appDownloadsPath = '';
    let userDownloadsPath = '';

    // Try to get paths from Electron API
    if (window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
        try {
            userDownloadsPath = await window.electronAPI.getDefaultDownloadFolder();
        } catch (e) {
            console.error('Failed to get default download folder:', e);
        }
    }

    // Get app directory path for first startup
    if (window.electronAPI && window.electronAPI.getUserDataPath) {
        try {
            const userDataPath = await window.electronAPI.getUserDataPath();
            // Use a 'downloads' folder inside the app's userData directory
            appDownloadsPath = userDataPath.replace(/\\/g, '/') + '/downloads';
        } catch (e) {
            console.error('Failed to get userData path:', e);
            // Fallback: use userDownloadsPath if available
            appDownloadsPath = userDownloadsPath || '';
        }
    } else {
        // Fallback if no Electron API - will be set by userDownloadsPath if available
        appDownloadsPath = userDownloadsPath || '';
    }

    if (downloadFolderInput) {
        let savedFolder = localStorage.getItem('downloadFolder');
        let isFirstLaunch = !localStorage.getItem('hasLaunchedBefore');

        if (!savedFolder) {
            if (isFirstLaunch) {
                // First startup: use app's downloads folder
                downloadFolderInput.value = appDownloadsPath;
                localStorage.setItem('downloadFolder', appDownloadsPath);
                localStorage.setItem('hasLaunchedBefore', 'true');
            } else {
                // Subsequent launches but no saved folder: use user's Downloads
                downloadFolderInput.value = userDownloadsPath || appDownloadsPath;
                localStorage.setItem('downloadFolder', userDownloadsPath || appDownloadsPath);
            }
        } else {
            downloadFolderInput.value = savedFolder;
        }
    }

    // Update default folder button to use the user's Downloads folder
    const defaultFolderBtn = document.getElementById('defaultFolderBtn');
    if (defaultFolderBtn) {
        defaultFolderBtn.onclick = async () => {
            const downloadFolderInput = document.getElementById('downloadFolder');
            if (downloadFolderInput) {
                let defaultPath = userDownloadsPath;

                // If we don't have it yet, try to get it
                if (!defaultPath && window.electronAPI && window.electronAPI.getDefaultDownloadFolder) {
                    try {
                        defaultPath = await window.electronAPI.getDefaultDownloadFolder();
                    } catch (e) {
                        console.error('Failed to get default download folder:', e);
                        // Fallback for Windows - will be replaced by Electron API when available
                        defaultPath = 'C:/Users/User/Downloads';
                    }
                }

                if (!defaultPath) {
                    // Final fallback
                    defaultPath = 'C:/Users/User/Downloads';
                }

                downloadFolderInput.value = defaultPath;
                localStorage.setItem('downloadFolder', defaultPath);
            }
        };
    }
    // ==================== CLOSE CONFIRMATION MODAL LOGIC ====================
    if (window.electronAPI && window.electronAPI.onShowCloseConfirmation) {
        const closeConfirmationModal = document.getElementById('closeConfirmationModal');
        const closeConfirmExitBtn = document.getElementById('closeConfirmExitBtn');
        const closeConfirmTrayBtn = document.getElementById('closeConfirmTrayBtn');
        const closeConfirmCancelBtn = document.getElementById('closeConfirmCancelBtn');
        const closeConfirmationMessage = document.getElementById('closeConfirmationMessage');

        // Listen for close confirmation request from Main Process
        window.electronAPI.onShowCloseConfirmation((activeCount) => {
            if (closeConfirmationModal && closeConfirmationMessage) {
                // Update message with count
                const countText = activeCount === 1 ? '1 download is' : `${activeCount} downloads are`;
                closeConfirmationMessage.textContent = `${countText} currently in progress. What would you like to do?`;

                // Show modal
                openModalWithFocus(closeConfirmationModal, closeConfirmTrayBtn || closeConfirmCancelBtn);

                // Animate entry
                const modalContent = closeConfirmationModal.querySelector('.modal-content');
                if (modalContent) {
                    modalContent.style.animation = 'none';
                    modalContent.offsetHeight; /* trigger reflow */
                    modalContent.style.animation = 'scaleIn 0.3s ease-out forwards';
                }
            }
        });

        // ACTION: Cancel & Exit
        if (closeConfirmExitBtn) {
            closeConfirmExitBtn.onclick = () => {
                if (window.electronAPI.sendCloseAction) {
                    window.electronAPI.sendCloseAction('exit');
                }
                closeModalWithFocusRestore(closeConfirmationModal);
            };
        }

        // ACTION: Minimize to Tray
        if (closeConfirmTrayBtn) {
            closeConfirmTrayBtn.onclick = () => {
                if (window.electronAPI.sendCloseAction) {
                    window.electronAPI.sendCloseAction('minimize-to-tray');
                }
                closeModalWithFocusRestore(closeConfirmationModal);
            };
        }

        // ACTION: Cancel (Go Back)
        if (closeConfirmCancelBtn) {
            closeConfirmCancelBtn.onclick = () => {
                if (window.electronAPI.sendCloseAction) {
                    window.electronAPI.sendCloseAction('cancel');
                }
                closeModalWithFocusRestore(closeConfirmationModal);
            };
        }

        // Close on outside click (treat as cancel)
        window.onclick = (event) => {
            if (event.target === closeConfirmationModal) {
                if (window.electronAPI.sendCloseAction) {
                    window.electronAPI.sendCloseAction('cancel');
                }
                closeModalWithFocusRestore(closeConfirmationModal);
            }
            // Existing window.onclick logic for other modals...
            const onboardingModal = document.getElementById('onboardingModal');
            if (event.target === onboardingModal) {
                if (window.openOnboarding) {
                    const closeModal = () => {
                        onboardingModal.style.display = 'none';
                        document.body.style.overflow = '';
                        localStorage.setItem('ytdTutorialCompleted', 'true');
                    };
                    closeModal();
                }
            }
            const settingsModal = document.getElementById('settingsModal');
            if (event.target === settingsModal) {
                closeModalWithFocusRestore(settingsModal);
            }
            const confirmationModal = document.getElementById('confirmationModal');
            if (event.target === confirmationModal) {
                closeModalWithFocusRestore(confirmationModal);
            }
        };
    }
});
