// script.js - Frontend logic for Simple YTD

// Move these to global scope (before DOMContentLoaded)
let ws;
let clientId = localStorage.getItem('ytdClientId');
let activeDownloader = localStorage.getItem('activeDownloader') || 'youtube';
let userSettings;
let downloadItemsState;
let isPowerSaveBlockerActive = false;

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
    const startYoutubeDownloadBtn = document.getElementById('startYoutubeDownloadBtn');
    const youtubeStatusDiv = document.getElementById('status');
    const youtubeDownloadLinksArea = document.getElementById('downloadLinksArea');

    const instagramUrlInput = document.getElementById('instagramUrl');
    const instagramQualitySelect = document.getElementById('instagramQuality');
    const startInstagramDownloadBtn = document.getElementById('startInstagramDownloadBtn');
    const instagramStatusDiv = document.getElementById('instagramStatus');
    const instagramDownloadLinksArea = document.getElementById('instagramDownloadLinksArea');

    const youtubeTab = document.getElementById('youtubeTab');
    const instagramTab = document.getElementById('instagramTab');
    const contactUsTab = document.querySelector('nav.main-nav a[href="contact.html"]');
    const historyTab = document.getElementById('historyTab');

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');

    const maxSpeedInput = document.getElementById('maxSpeed');
    const numerateFilesCheckbox = document.getElementById('numerateFiles');
    const skipDuplicatesCheckbox = document.getElementById('skipDuplicates');
    const searchTagsCheckbox = document.getElementById('searchTags');
    const removeCompletedCheckbox = document.getElementById('removeCompleted');
    const notificationSoundCheckbox = document.getElementById('notificationSound');
    const notificationPopupCheckbox = document.getElementById('notificationPopup');
    let keepPcAwakeCheckbox = document.getElementById('keepPcAwake');
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
    const pasteInstagramUrlBtn = document.getElementById('pasteInstagramUrlBtn');

    const clearYoutubeDownloadsBtn = document.getElementById('clearYoutubeDownloadsBtn');
    const clearInstagramDownloadsBtn = document.getElementById('clearInstagramDownloadsBtn');

    const compactModeCheckbox = document.getElementById('compactMode');

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
        return downloadFolderInput && downloadFolderInput.value ? downloadFolderInput.value : '';
    }

    // --- WebSocket Connection ---
    // Only connect WebSocket if on index.html (where download functionality is)
    if (document.getElementById('youtubeDownloader') || document.getElementById('instagramDownloader')) {
        connectWebSocket();
    }

    function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.hostname}:3000?clientId=${clientId}`;
        console.log(`Attempting to connect to WebSocket: ${wsUrl}`);

        ws = new WebSocket(wsUrl);
        window.ws = ws; // Make it globally accessible

        ws.onopen = () => {
            console.log('WebSocket connection established.');
            // Show connected status immediately
            if (youtubeStatusDiv) showStatus('Connected to server.', 'youtube', 'success');
            if (instagramStatusDiv) showStatus('Connected to server.', 'instagram', 'success');
            
            // Also update any other UI elements that show connection status
            const connectionIndicators = document.querySelectorAll('.connection-status');
            connectionIndicators.forEach(indicator => {
                indicator.textContent = 'Connected';
                indicator.className = 'connection-status connected';
            });
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message received:', data);
                
                // Handle ready message specifically
                if (data.type === 'ready') {
                    console.log('Server ready message received');
                    const currentStatusDiv = activeDownloader === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
                    if (currentStatusDiv) {
                        showStatus('Server ready - you can start downloading!', activeDownloader, 'success');
                    }
                    return;
                }
                
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                const currentStatusDiv = activeDownloader === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
                if (currentStatusDiv) {
                    showStatus('Error processing message from server.', activeDownloader, 'error');
                }
            }
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed. Attempting to reconnect...');
            if (youtubeStatusDiv) showStatus('Disconnected. Attempting to reconnect...', 'youtube', 'error');
            if (instagramStatusDiv) showStatus('Disconnected. Attempting to reconnect...', 'instagram', 'error');
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (youtubeStatusDiv) showStatus('WebSocket connection error.', 'youtube', 'error');
            if (instagramStatusDiv) showStatus('WebSocket connection error.', 'instagram', 'error');
        };
    }

    function sendMessageToServer(type, payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({ type, ...payload });
            ws.send(message);
            console.log('WebSocket message sent:', message);
        } else {
            console.error('WebSocket is not connected.');
            const currentStatusDiv = activeDownloader === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
            if (currentStatusDiv) {
                 showStatus('Not connected to server. Please wait.', activeDownloader, 'error');
            }
        }
    }

    // --- Message Handling ---
    function handleWebSocketMessage(data) {
        const { type, message, itemId, downloadUrl, filename, title, actualSize, percent, rawSpeed, speedBytesPerSec, source = activeDownloader, isPlaylistItem, playlistIndex, thumbnail, fullPath } = data;
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
                updateDownloadItemStatus(itemId, message || 'Queued...', source);
                // Show pause/play button and remove button immediately for queued items
                const queuedItemDiv = document.getElementById(`item-${itemId}`);
                if (queuedItemDiv) {
                    const pausePlayBtn = queuedItemDiv.querySelector('.item-pause-play-btn');
                    const removeBtn = queuedItemDiv.querySelector('.item-remove-btn');
                    if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                    if (removeBtn) removeBtn.style.display = 'inline-flex';
                }
                if (currentItemState) currentItemState.status = 'queued';
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
                if (thumbnail) updateDownloadItemThumbnail(itemId, thumbnail);
                if (currentItemState) {
                    currentItemState.title = title;
                    if (thumbnail) currentItemState.thumbnail = thumbnail;
                    if (fullPath) currentItemState.fullPath = fullPath;
                }
                break;
            case 'progress':
                updateDownloadItemProgress(itemId, message, percent, rawSpeed, source, speedBytesPerSec);
                if (currentItemState) currentItemState.status = 'downloading';
                updateDownloadStats();
                break;
            case 'complete':
                updateDownloadItemComplete(itemId, message, downloadUrl, filename, actualSize, source, fullPath, thumbnail);
                if (userSettings.notificationSound && completionSound) playNotificationSound();
                if (userSettings.notificationPopup) showDesktopNotification(filename || title, message || 'Download complete!');
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
                const history = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
                history.unshift({
                  name: filename,
                  path: downloadUrl,
                  folder: data.downloadFolder || getDownloadFolder(), // <-- add this
                  type: subtabKey === 'youtube' ? 'youtubeSingles' : subtabKey,
                  size: actualSize || 'N/A',
                  mtime: new Date().toISOString(),
                  thumbnail: (thumbnail || currentItemState?.thumbnail) || null
                });
                localStorage.setItem('ytdHistory', JSON.stringify(history.slice(0, 500)));
                renderFromLocalStorage();
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
            case 'status':
                const statusDivForGeneral = source === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
                if (statusDivForGeneral) {
                    showStatus(message, source, 'info');
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
                 const statusDivForPlaylist = source === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
                 if (statusDivForPlaylist) {
                    showStatus(message || `Playlist processing finished for ${source}.`, source, 'success');
                 }
                break;
            default:
                console.warn('Unknown WebSocket message type:', type);
        }
    }

    // --- UI Updates ---
    function showStatus(message, downloaderSource, type = 'info') {
        const statusDiv = downloaderSource === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
        if (statusDiv) {
            statusDiv.textContent = message;
            statusDiv.className = 'status-message';
            if (type === 'success') statusDiv.classList.add('success');
            else if (type === 'error') statusDiv.classList.add('error');
            else if (type === 'cancelled') statusDiv.classList.add('error');
        }
    }

    function getLinksArea(source) {
        return source === 'youtube' ? youtubeDownloadLinksArea : instagramDownloadLinksArea;
    }

    function createDownloadItemStructure(itemId, titleText, source, isPlaylistItem = false) {
        const linksArea = getLinksArea(source);
        if (!linksArea || downloadItemsState.has(itemId)) return;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'download-item';
        itemDiv.id = `item-${itemId}`;
        itemDiv.dataset.itemId = itemId;

        const thumbnailImg = document.createElement('img');
        thumbnailImg.className = 'item-thumbnail';
        thumbnailImg.src = `https://placehold.co/120x90/e0e0e0/7f7f7f?text=${source.charAt(0).toUpperCase()}`;
        thumbnailImg.alt = 'Video thumbnail';
        itemDiv.appendChild(thumbnailImg);

        const itemContentDiv = document.createElement('div');
        itemContentDiv.className = 'item-content';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'item-title';
        titleDiv.textContent = titleText;
        itemContentDiv.appendChild(titleDiv);

        const statusDiv = document.createElement('div');
        statusDiv.className = 'item-status';
        statusDiv.textContent = 'Queued...';
        itemContentDiv.appendChild(statusDiv);

        const progressBarContainer = document.createElement('div');
        progressBarContainer.className = 'progress-bar-container';
        progressBarContainer.style.display = 'none';

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
        pausePlayBtn.style.display = 'none';
        pausePlayBtn.onclick = () => handlePausePlayToggle(itemId, source);
        controlButtonsDiv.appendChild(pausePlayBtn);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'item-control-btn item-remove-btn';
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.title = 'Remove this item';
        removeBtn.style.display = 'none';
        removeBtn.onclick = () => handleRemoveDownloadItem(itemId, source);
        controlButtonsDiv.appendChild(removeBtn);

        buttonsDiv.appendChild(controlButtonsDiv);

        // Cancel button (below control buttons)
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'item-cancel-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => handleCancelDownload(itemId, source);
        buttonsDiv.appendChild(cancelBtn);

        itemDiv.appendChild(buttonsDiv);
        linksArea.prepend(itemDiv);

        downloadItemsState.set(itemId, {
            title: titleText, 
            status: 'queued', 
            source: source,
            domElement: itemDiv,
            isPlaylist: isPlaylistItem, // Store the playlist flag
            thumbnailEl: thumbnailImg
        });
        
        updateDownloadStats();
    }

    function updateDownloadItemStatus(itemId, statusText, source, statusType = 'info') {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const statusEl = itemDiv.querySelector('.item-status');
            if (statusEl) {
                statusEl.textContent = statusText;
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

    function updateDownloadItemProgress(itemId, message, percent, rawSpeed, source, speedBytesPerSec) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            // Only update the progress bar and status text, do not recreate or reload the element
            const statusEl = itemDiv.querySelector('.item-status');
            const progressBarContainer = itemDiv.querySelector('.progress-bar-container');
            const progressBar = itemDiv.querySelector('.progress-bar');

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
                progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
            }
            
            // Show pause/play button and remove button when download starts (when progress > 0)
            if (typeof percent === 'number' && percent > 0) {
                const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
                const removeBtn = itemDiv.querySelector('.item-remove-btn');
                if (pausePlayBtn) pausePlayBtn.style.display = 'inline-flex';
                if (removeBtn) removeBtn.style.display = 'inline-flex';
            }
        }
    }

    function updateDownloadItemComplete(itemId, message, downloadUrl, filename, actualSize, source, fullPath, thumb) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            // Compact status message: "Download complete • filesize"
            const statusText = `Download complete${actualSize ? ' • ' + actualSize : ''}`;
            updateDownloadItemStatus(itemId, statusText, source, 'success');
            
            const linkEl = itemDiv.querySelector('.item-link');
            if (linkEl && downloadUrl && filename) {
                linkEl.innerHTML = '';
                
                const openFolderBtn = document.createElement('button');
                openFolderBtn.className = 'modern-folder-btn compact-folder-btn';
                openFolderBtn.title = 'Open containing folder';
                openFolderBtn.innerHTML = '<i class="fas fa-folder-open"></i> Open Folder';
                openFolderBtn.onclick = async () => {
                    if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                        try {
                            let targetPath = fullPath;
                            if (!targetPath && window.electronAPI?.resolvePath) {
                                const root = getDownloadFolder();
                                const rel = decodeURIComponent(downloadUrl.replace('/downloads/', ''));
                                targetPath = await window.electronAPI.resolvePath(root, rel);
                            }
                            const folderPath = window.electronAPI?.getDirname && targetPath
                                ? await window.electronAPI.getDirname(targetPath)
                                : getDownloadFolder();
                            await window.electronAPI.openPathInExplorer(folderPath);
                        } catch (e) {
                            console.error('Open folder failed:', e);
                            alert('Unable to open containing folder.');
                        }
                    } else {
                        console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                        alert('Open folder not available. Make sure you are running in Electron.');
                    }
                };
                linkEl.appendChild(openFolderBtn);
            }
            if (thumb) updateDownloadItemThumbnail(itemId, thumb);
            disableCancelButton(itemId, source);
            showActionButtons(itemId);
        }
    }

    function updateDownloadItemError(itemId, errorMessage, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            updateDownloadItemStatus(itemId, `Error: ${errorMessage}`, source, 'error');
            disableCancelButton(itemId, source);
            showActionButtons(itemId);
        }
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
        if(itemDiv){
            const cancelBtn = itemDiv.querySelector('.item-cancel-btn');
            if(cancelBtn) cancelBtn.disabled = true;
        }
    }

    function handleRemoveDownloadItem(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) itemDiv.remove();
        downloadItemsState.delete(itemId);
        updateDownloadStats();
        console.log(`Removed item ${itemId} from UI and state.`);
    }

    function showActionButtons(itemId) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const removeBtn = itemDiv.querySelector('.item-remove-btn');
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        }
    }

    // Dynamic pause/play toggle function
    function handlePausePlayToggle(itemId, source) {
        const itemDiv = document.getElementById(`item-${itemId}`);
        if (itemDiv) {
            const pausePlayBtn = itemDiv.querySelector('.item-pause-play-btn');
            if (pausePlayBtn) {
                const isPaused = pausePlayBtn.innerHTML.includes('fa-play');
                
                if (isPaused) {
                    // Currently paused, resume download
                    console.log(`[Placeholder] Resuming download for item: ${itemId}, source: ${source}`);
                    pausePlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    pausePlayBtn.title = 'Pause download';
                    updateDownloadItemStatus(itemId, 'Resuming...', source);
                } else {
                    // Currently downloading, pause download
                    console.log(`[Placeholder] Pausing download for item: ${itemId}, source: ${source}`);
                    pausePlayBtn.innerHTML = '<i class="fas fa-play"></i>';
                    pausePlayBtn.title = 'Resume download';
                    updateDownloadItemStatus(itemId, 'Paused', source);
                }
            }
        }
    }

    // --- Download Initiation ---
    async function fetchVideoInfo(url, source) {
        if (!youtubeUrlInput && !instagramUrlInput) return null;
        try {
            const response = await fetch('/video-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, clientId, source })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
                throw new Error(errorData.error || `HTTP error ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error fetching video info for ${url} (${source}):`, error);
            const statusDiv = source === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
            if (statusDiv) {
                 showStatus(`Error fetching info: ${error.message}`, source, 'error');
            }
            return null;
        }
    }

    async function startDownloadCommon(url, format, quality, source, playlistActionVal, concurrencyVal, singleConcurrencyVal) {
        const statusDiv = source === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
        if (!url) {
            if (statusDiv) showStatus('Please paste a URL.', source, 'error');
            return;
        }
        if (statusDiv) showStatus('Requesting download...', source, 'info');

        const payload = {
            url, format, quality, clientId, source,
            playlistAction: playlistActionVal,
            concurrency: concurrencyVal,
            singleConcurrency: singleConcurrencyVal,
            ...userSettings,
            downloadFolder: getDownloadFolder()
        };
        sendMessageToServer('download_request', payload);
    }

    if (startYoutubeDownloadBtn) {
        startYoutubeDownloadBtn.onclick = () => {
            const url = youtubeUrlInput.value.trim();
            const format = formatSelect.value;
            const qualityVal = qualitySelect.value;
            const singleConcurrencyRadio = document.querySelector('input[name="singleConcurrency"]:checked');
            const singleConcurrency = singleConcurrencyRadio ? singleConcurrencyRadio.value : '1';
            const isPlaylist = url.includes('list=') && playlistOptionsDiv && playlistOptionsDiv.style.display !== 'none';
            const playlistAction = isPlaylist && playlistActionSelect ? playlistActionSelect.value : 'single';
            const concurrency = isPlaylist && playlistAction === 'full' && playlistConcurrencySelect ? playlistConcurrencySelect.value : 1;

            startDownloadCommon(url, format, qualityVal, 'youtube', playlistAction, parseInt(concurrency), parseInt(singleConcurrency));
        };
    }

    if (startInstagramDownloadBtn) {
        startInstagramDownloadBtn.onclick = () => {
            const url = instagramUrlInput.value.trim();
            const qualityVal = instagramQualitySelect ? instagramQualitySelect.value : 'highest';
            startDownloadCommon(url, 'mp4', qualityVal, 'instagram', 'single', 1, 1);
        };
    }

    // --- Quality Options & Playlist Detection ---
    function populateQualityOptions(selectElement, format, source) {
        if (!selectElement) return;
        selectElement.innerHTML = '';

        let qualities = [];
        if (source === 'youtube') {
            if (format === 'mp4') {
                qualities = [
                    { value: 'highest', text: 'Highest Available MP4' },
                    { value: '2160', text: '4K' },
                    { value: '1440', text: '1440p' },
                    { value: '1080', text: '1080p' },
                    { value: '720', text: '720p' },
                    { value: '480', text: '480p' },
                    { value: '360', text: '360p' }
                ];
            } else if (format === 'mp3') {
                qualities = [
                    { value: 'highest', text: 'Highest Quality MP3' },
                    { value: '320', text: '320 kbps' },
                    { value: '256', text: '256 kbps' },
                    { value: '192', text: '192 kbps' },
                    { value: '128', text: '128 kbps' }
                ];
            }
        } else if (source === 'instagram') {
            qualities = [
                { value: 'highest', text: 'Highest Available' },
                { value: '1080', text: '1080p' },
                { value: '720', text: '720p' }
            ];
        }
        qualities.forEach(q => {
            const option = document.createElement('option');
            option.value = q.value;
            option.textContent = q.text;
            selectElement.appendChild(option);
        });
    }

    if (formatSelect && qualitySelect) {
        formatSelect.addEventListener('change', () => populateQualityOptions(qualitySelect, formatSelect.value, 'youtube'));
        populateQualityOptions(qualitySelect, formatSelect.value, 'youtube');
    }
    if (instagramQualitySelect) {
        populateQualityOptions(instagramQualitySelect, 'mp4', 'instagram');
    }

    function detectPlaylist() {
      if (!youtubeUrlInput || !playlistOptionsDiv) return;
      const url = youtubeUrlInput.value;
      playlistOptionsDiv.style.display = url.includes('list=') ? 'block' : 'none';
      if (playlistOptionsDiv.style.display === 'block' && playlistActionSelect) {
        playlistActionSelect.dispatchEvent(new Event('change'));
      }
    }
    if (youtubeUrlInput && playlistOptionsDiv && playlistActionSelect) {
      youtubeUrlInput.addEventListener('input', detectPlaylist);
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

    // --- Tab Management ---
    function showTab(tab) {
      ['youtubeDownloader', 'instagramDownloader', 'historyPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      ['youtubeTab', 'instagramTab', 'historyTab'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      const panelId = tab === 'history' ? 'historyPanel' : `${tab}Downloader`;
      const navId   = `${tab}Tab`;
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
      if (tab === 'instagram') {
        if (ws && ws.readyState === WebSocket.OPEN && instagramStatusDiv) {
          showStatus('Connected to server.', 'instagram', 'success');
        }
      }
    }
    if (youtubeTab) youtubeTab.onclick = (e) => { e.preventDefault(); showTab('youtube'); };
    if (instagramTab) instagramTab.onclick = (e) => { e.preventDefault(); showTab('instagram'); };
    if (historyTab) historyTab.onclick = (e) => { e.preventDefault(); showTab('history'); };

    // --- Theme Management ---
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        const selectFields = document.querySelectorAll('.select-field');
        selectFields.forEach(select => {
            if (!select) return;
            const isDark = theme === 'dark';
            const arrowColorHex = isDark ? 'f8f9fa' : (getComputedStyle(document.documentElement).getPropertyValue('--text-color') || '#2d3436').trim().substring(1);
            select.style.backgroundImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23${arrowColorHex}'%3E%3Cpath fill-rule='evenodd' d='M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z' clip-rule='evenodd'/%3E%3C/svg%3E")`;
        });
        document.querySelectorAll('.progress-bar').forEach(pb => {
             if (!pb) return;
            pb.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--progress-bar-bg').trim();
        });
    }

    // --- Settings Modal ---
    function loadSettings() {
        const defaults = {
            maxSpeed: 0, 
            numerateFiles: false, 
            skipDuplicates: false, 
            searchTags: false,
            removeCompleted: false, 
            notificationSound: true, 
            notificationPopup: true, 
            speedUnitDisplay: 'Mbps',
            downloadFolder: '', 
            compactMode: false,
            skipDeleteConfirmation: false,
            themePreset: 'light',
            keepPcAwake: true
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
        
        userSettings = {
            maxSpeed: maxSpeedInput ? (parseInt(maxSpeedInput.value, 10) || 0) : 0,
            numerateFiles: numerateFilesCheckbox ? numerateFilesCheckbox.checked : false,
            skipDuplicates: skipDuplicatesCheckbox ? skipDuplicatesCheckbox.checked : false,
            searchTags: searchTagsCheckbox ? searchTagsCheckbox.checked : false,
            removeCompleted: removeCompletedCheckbox ? removeCompletedCheckbox.checked : false,
            notificationSound: notificationSoundCheckbox ? notificationSoundCheckbox.checked : true,
            notificationPopup: notificationPopupCheckbox ? notificationPopupCheckbox.checked : true,
            speedUnitDisplay: speedUnitDisplaySelect ? speedUnitDisplaySelect.value : 'Mbps',
            downloadFolder: downloadFolderInput ? downloadFolderInput.value : '',
            compactMode: compactModeCheckbox ? compactModeCheckbox.checked : false,
            skipDeleteConfirmation: skipDeleteConfirmationCheckbox ? skipDeleteConfirmationCheckbox.checked : false,
            themePreset: themePresetSelect ? themePresetSelect.value : 'light',
            keepPcAwake: keepPcAwakeCheckbox ? keepPcAwakeCheckbox.checked : true
        };
        localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
        
        // Update global reference
        window.userSettings = userSettings;
        
        // Apply theme immediately
        applyTheme(userSettings.themePreset);
        
        if (settingsModal) settingsModal.style.display = 'none';
        
        const currentStatusDiv = activeDownloader === 'youtube' ? youtubeStatusDiv : instagramStatusDiv;
        if (currentStatusDiv) {
            showStatus('Settings saved!', activeDownloader, 'success');
        }
        console.log("Settings saved:", userSettings);
    }

    function populateSettingsModal() {
        if (!settingsModal) return;
        
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
        
        if (maxSpeedInput) maxSpeedInput.value = userSettings.maxSpeed;
        if (numerateFilesCheckbox) numerateFilesCheckbox.checked = userSettings.numerateFiles;
        if (skipDuplicatesCheckbox) skipDuplicatesCheckbox.checked = userSettings.skipDuplicates;
        if (searchTagsCheckbox) searchTagsCheckbox.checked = userSettings.searchTags;
        if (removeCompletedCheckbox) removeCompletedCheckbox.checked = userSettings.removeCompleted;
        if (notificationSoundCheckbox) notificationSoundCheckbox.checked = userSettings.notificationSound;
        if (notificationPopupCheckbox) notificationPopupCheckbox.checked = userSettings.notificationPopup;
        if (keepPcAwakeCheckbox) keepPcAwakeCheckbox.checked = userSettings.keepPcAwake;
        if (speedUnitDisplaySelect) speedUnitDisplaySelect.value = userSettings.speedUnitDisplay;
        if (downloadFolderInput) downloadFolderInput.value = userSettings.downloadFolder || '';
        if (compactModeCheckbox) compactModeCheckbox.checked = userSettings.compactMode;
        if (skipDeleteConfirmationCheckbox) skipDeleteConfirmationCheckbox.checked = userSettings.skipDeleteConfirmation;
        if (themePresetSelect) themePresetSelect.value = userSettings.themePreset;
        applyCompactMode(userSettings.compactMode);
    }

    if (settingsBtn) {
        settingsBtn.onclick = () => {
            populateSettingsModal();
            if (settingsModal) settingsModal.style.display = 'flex';
        };
    }
    if (closeSettingsBtn) {
        closeSettingsBtn.onclick = () => {
            if (settingsModal) settingsModal.style.display = 'none';
        };
    }
    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = saveSettings;
    }
    
    // Update tools button
    const updateToolsBtn = document.getElementById('updateToolsBtn');
    if (updateToolsBtn) {
        updateToolsBtn.onclick = async () => {
            try {
                updateToolsBtn.disabled = true;
                updateToolsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
                
                const result = await window.updateTools();
                
                if (result) {
                    let message = 'Tools update completed!\n\n';
                    
                    if (result.ytdlp && result.ytdlp.updated) {
                        message += `✅ yt-dlp: ${result.ytdlp.oldVersion} → ${result.ytdlp.newVersion}\n`;
                    } else if (result.ytdlp) {
                        message += `ℹ️ yt-dlp: ${result.ytdlp.reason || 'No update needed'}\n`;
                    }
                    
                    if (result.ffmpeg && result.ffmpeg.hasUpdate) {
                        message += `🔄 FFmpeg: Update available (${result.ffmpeg.latestVersion})\n`;
                        message += '💡 Download from: https://ffmpeg.org/download.html\n';
                    } else if (result.ffmpeg) {
                        message += `ℹ️ FFmpeg: ${result.ffmpeg.reason || 'No update needed'}\n`;
                    }
                    
                    alert(message);
                }
            } catch (error) {
                console.error('Error updating tools:', error);
                alert('Error updating tools. Check console for details.');
            } finally {
                updateToolsBtn.disabled = false;
                updateToolsBtn.innerHTML = '<i class="fas fa-download"></i> Update Tools';
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
            settingsModal.style.display = 'none';
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

    function confirmDelete(message) {
        if (shouldSkipDeleteConfirmation()) {
            return true;
        }
        return confirm(message);
    }

    // --- Initializations ---
    applyTheme(userSettings.themePreset || 'light');
    
    if (document.getElementById('youtubeDownloader') || document.getElementById('instagramDownloader')) {
        showTab(activeDownloader);
    } else if (contactUsTab) {
        showTab('youtube');
        document.body.classList.remove('instagram-theme-active');
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
                alert('Folder picker not available. Make sure you are running in Electron.');
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
                alert('Default folder not available. Make sure you are running in Electron.');
            }
        };
    }
    if (openFolderBtn && downloadFolderInput) {
        openFolderBtn.onclick = async () => {
            const folderPath = downloadFolderInput.value;
            if (!folderPath) {
                alert('No folder selected.');
                return;
            }
            if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                await window.electronAPI.openPathInExplorer(folderPath);
            } else {
                console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                alert('Open folder not available. Make sure you are running in Electron.');
            }
        };
    }

    // Paste button logic
    if (pasteYoutubeUrlBtn && youtubeUrlInput) {
        pasteYoutubeUrlBtn.onclick = () => navigator.clipboard.readText().then(t => {
            youtubeUrlInput.value = t;
            setTimeout(() => {
                const url = youtubeUrlInput.value.trim();
                if (url) fetchVideoInfo(url, 'youtube');
            }, 50);
        });
    }
    if (pasteInstagramUrlBtn && instagramUrlInput) {
        pasteInstagramUrlBtn.onclick = () => navigator.clipboard.readText().then(t => {
            instagramUrlInput.value = t;
            setTimeout(() => {
                const url = instagramUrlInput.value.trim();
                if (url) fetchVideoInfo(url, 'instagram');
            }, 50);
        });
    }

    // Delete all buttons with confirmation
    if (clearYoutubeDownloadsBtn && youtubeDownloadLinksArea) {
        clearYoutubeDownloadsBtn.onclick = () => {
            if (confirmDelete('Are you sure you want to clear all YouTube downloads from the list?')) {
                youtubeDownloadLinksArea.replaceChildren(clearYoutubeDownloadsBtn);
            }
        };
    }
    if (clearInstagramDownloadsBtn && instagramDownloadLinksArea) {
        clearInstagramDownloadsBtn.onclick = () => {
            if (confirmDelete('Are you sure you want to clear all Instagram downloads from the list?')) {
                instagramDownloadLinksArea.replaceChildren(clearInstagramDownloadsBtn);
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
        if (queuedCount) queuedCount.textContent = queuedItems;
        if (downloadingCount) downloadingCount.textContent = downloadingItems;
        if (downloadedCount) downloadedCount.textContent = completedItems;
        
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





    // Speed Slider Widget
    if (headerSpeedSlider && speedValue) {
        headerSpeedSlider.value = userSettings.maxSpeed || 0;
        speedValue.textContent = userSettings.maxSpeed > 0 ? userSettings.maxSpeed : '∞';
        headerSpeedSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            speedValue.textContent = val > 0 ? val : '∞';
        });
        headerSpeedSlider.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            if (maxSpeedInput) maxSpeedInput.value = val;
            userSettings.maxSpeed = val;
            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
            saveSettings();
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

    // Compact Mode Toggle
    function applyCompactMode(compact) {
        if (compact) {
            document.body.classList.add('compact-mode');
            console.log('Compact mode enabled');
        } else {
            document.body.classList.remove('compact-mode');
            console.log('Compact mode disabled');
        }
    }
    if (compactModeCheckbox) {
        compactModeCheckbox.addEventListener('change', () => {
            applyCompactMode(compactModeCheckbox.checked);
            userSettings.compactMode = compactModeCheckbox.checked;
            localStorage.setItem('ytdUserSettings', JSON.stringify(userSettings));
        });
    }
    applyCompactMode(userSettings.compactMode);





    // Tool update functions
    window.checkToolsStatus = async function() {
        console.log('=== Checking Tools Status ===');
        try {
            const response = await fetch('/tools-status');
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

    window.updateTools = async function() {
        console.log('=== Updating Tools ===');
        try {
            console.log('🔄 Starting tool updates...');
            
            const response = await fetch('/update-tools', { method: 'POST' });
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

    window.forceUpdateTools = async function() {
        console.log('=== Force Updating Tools ===');
        try {
            // Clear last update check to force update
            console.log('🔄 Clearing update check timestamps...');
            
            // Force update by clearing timestamps (this will be handled server-side)
            const response = await fetch('/force-update-tools', { method: 'POST' });
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
                alert('Folder picker not available. Make sure you are running in Electron.');
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
                alert('Default folder not available. Make sure you are running in Electron.');
            }
        };
    }
    if (openFolderBtn && downloadFolderInput) {
        openFolderBtn.onclick = async () => {
            const folderPath = downloadFolderInput.value;
            if (!folderPath) {
                alert('No folder selected.');
                return;
            }
            if (window.electronAPI && window.electronAPI.openPathInExplorer) {
                await window.electronAPI.openPathInExplorer(folderPath);
            } else {
                console.error('Open folder not available. window.electronAPI:', window.electronAPI);
                alert('Open folder not available. Make sure you are running in Electron.');
            }
        };
    }

    // Paste button logic
    if (pasteYoutubeUrlBtn && youtubeUrlInput) {
        pasteYoutubeUrlBtn.onclick = () => navigator.clipboard.readText().then(t => {
            youtubeUrlInput.value = t;
            setTimeout(() => {
                const url = youtubeUrlInput.value.trim();
                if (url) fetchVideoInfo(url, 'youtube');
            }, 50);
        });
    }
    if (pasteInstagramUrlBtn && instagramUrlInput) {
        pasteInstagramUrlBtn.onclick = () => navigator.clipboard.readText().then(t => {
            instagramUrlInput.value = t;
            setTimeout(() => {
                const url = instagramUrlInput.value.trim();
                if (url) fetchVideoInfo(url, 'instagram');
            }, 50);
        });
    }

    // Delete all buttons with confirmation
    if (clearYoutubeDownloadsBtn && youtubeDownloadLinksArea) {
        clearYoutubeDownloadsBtn.onclick = () => {
            if (confirmDelete('Are you sure you want to clear all YouTube downloads from the list?')) {
                youtubeDownloadLinksArea.replaceChildren(clearYoutubeDownloadsBtn);
            }
        };
    }
    if (clearInstagramDownloadsBtn && instagramDownloadLinksArea) {
        clearInstagramDownloadsBtn.onclick = () => {
            if (confirmDelete('Are you sure you want to clear all Instagram downloads from the list?')) {
                instagramDownloadLinksArea.replaceChildren(clearInstagramDownloadsBtn);
            }
        };
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
      youtubeSingles:   document.getElementById('historyYoutubeSingles'),
      instagram:        document.getElementById('historyInstagram')
    };

    function activateHistoryTab(tabKey) {
      Object.values(historyLists).forEach(list => list && (list.style.display = 'none'));
      historyTabs.forEach(btn => btn.classList.remove('active'));
      const list = historyLists[tabKey];
      const btn  = document.querySelector(`.history-tab[data-history="${tabKey}"]`);
      if (list) list.style.display = 'grid';
      if (btn)  btn.classList.add('active');
    }

    // History Management Variables
    let historySearchTerm = '';
    let bulkSelectionMode = false;
    let selectedHistoryItems = new Set();
    let currentTimeFilter = 'all';
    let currentSort = 'newest';
    let allHistoryItems = [];

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
                filterAndRenderHistory();
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

    function filterAndRenderHistory() {
        const allHistory = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
        let filteredItems = filterHistoryByTime(allHistory);
        filteredItems = filterHistoryBySearch(filteredItems);
        filteredItems = sortHistoryItems(filteredItems);
        const groupedItems = {
            youtubePlaylists: filteredItems.filter(item => item.type === 'youtubePlaylists'),
            youtubeSingles: filteredItems.filter(item => item.type === 'youtubeSingles'),
            instagram: filteredItems.filter(item => item.type === 'instagram')
        };
        renderHistoryGroups(groupedItems);
        updateItemCount(filteredItems.length);
    }

    async function renderHistoryGroups(groupedItems) {
        const rootFolder = getDownloadFolder();
        Object.values(historyLists).forEach(list => {
            if (list) list.innerHTML = '';
        });
        for (const [type, items] of Object.entries(groupedItems)) {
            const list = historyLists[type];
            if (!list) continue;
            for (const [index, item] of items.entries()) {
                const historyItem = await createHistoryItemElement(item, index, rootFolder);
                if (historyItem) {
                    list.appendChild(historyItem);
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
            const itemFolder = item.folder || rootFolder;
            if (item.path.startsWith('/downloads/')) {
                let relativePath = decodeURIComponent(item.path.replace('/downloads/', ''));
                // If relativePath is already absolute, use it directly
                const isAbsolute = /^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith('/');
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
            let fileExists = true;
            if (window.electronAPI?.pathExists) {
                fileExists = await window.electronAPI.pathExists(absPath);
            }
            const div = document.createElement('div');
            div.className = 'history-item';
            div.dataset.index = index;
            div.dataset.originalIndex = findOriginalIndex(item);
            if (!fileExists) {
                div.classList.add('file-missing');
            }
            div.innerHTML = `
                    <img class="history-thumb" src="${item.thumbnail || 'https://placehold.co/120x90/e0e0e0/7f7f7f?text=Video'}" alt="Thumbnail" loading="lazy">
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
            return div;
        } catch (error) {
            console.error(`Error creating history item element:`, error);
            return null;
        }
    }

    function findOriginalIndex(targetItem) {
        const allHistory = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
        return allHistory.findIndex(item => 
            item.name === targetItem.name && 
            item.mtime === targetItem.mtime && 
            item.path === targetItem.path
        );
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
        if (bulkSelectionMode) {
            if (bulkActionsDiv) bulkActionsDiv.style.display = 'flex';
            if (bulkSelectBtn) {
                bulkSelectBtn.innerHTML = '<i class="fas fa-times"></i> Exit Bulk';
                bulkSelectBtn.classList.add('danger-btn');
            }
            applyBulkMode();
      } else {
            if (bulkActionsDiv) bulkActionsDiv.style.display = 'none';
            if (bulkSelectBtn) {
                bulkSelectBtn.innerHTML = '<i class="fas fa-check-square"></i> Bulk Select';
                bulkSelectBtn.classList.remove('danger-btn');
            }
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
            item.appendChild(checkbox);
        });
        updateSelectedCount();
    }

    function removeBulkMode() {
        selectedHistoryItems.clear();
        document.querySelectorAll('.history-item').forEach(item => {
            item.classList.remove('bulk-mode', 'selected');
            const checkbox = item.querySelector('.history-item-checkbox');
            if (checkbox) checkbox.remove();
        });
        updateSelectedCount();
    }

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

    function updateSelectedCount() {
        const countSpan = document.getElementById('selectedCount');
        if (countSpan) {
            countSpan.textContent = `${selectedHistoryItems.size} selected`;
        }
    }

    function setupBulkActionButtons() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('#selectAllHistoryBtn')) {
                selectAllItems();
            } else if (e.target.closest('#deselectAllHistoryBtn')) {
                deselectAllItems();
            } else if (e.target.closest('#deleteSelectedBtn')) {
                deleteSelectedItems();
            } else if (e.target.closest('#cancelSelectionBtn')) {
                toggleBulkSelectionMode();
            }
        });
    }

    function selectAllItems() {
        document.querySelectorAll('.history-item-checkbox').forEach(cb => {
            if (!cb.checked) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change'));
            }
        });
    }

    function deselectAllItems() {
        document.querySelectorAll('.history-item-checkbox').forEach(cb => {
            if (cb.checked) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });
    }

    async function deleteSelectedItems() {
        if (selectedHistoryItems.size === 0) {
            alert('No items selected for deletion.');
            return;
        }
        const confirmMessage = `Delete ${selectedHistoryItems.size} selected item${selectedHistoryItems.size !== 1 ? 's' : ''} permanently?`;
        if (!confirmDelete(confirmMessage)) return;
        
      const history = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
        const indicesToDelete = Array.from(selectedHistoryItems).sort((a, b) => b - a);
        let deletedCount = 0;
        let removedCount = 0;
        for (const index of indicesToDelete) {
            if (index >= 0 && index < history.length) {
                const item = history[index];
                if (item && window.electronAPI?.deleteFile) {
                    try {
                        let absPath;
                        const rootFolder = getDownloadFolder();
                        if (item.path.startsWith('/downloads/')) {
                            const relativePath = decodeURIComponent(item.path.replace('/downloads/', ''));
                            absPath = await window.electronAPI.resolvePath(rootFolder, relativePath);
                        } else {
                            absPath = item.path;
                        }
                        const result = await window.electronAPI.deleteFile(absPath);
                        if (result.success) deletedCount++;
                    } catch (error) {
                        console.error(`Failed to delete file for item ${index}:`, error);
                    }
                }
      history.splice(index, 1);
                removedCount++;
            }
        }
      localStorage.setItem('ytdHistory', JSON.stringify(history));
        selectedHistoryItems.clear();
        toggleBulkSelectionMode();
        filterAndRenderHistory();
        const message = deletedCount > 0 
            ? `Successfully deleted ${deletedCount} file${deletedCount !== 1 ? 's' : ''} and removed ${removedCount} item${removedCount !== 1 ? 's' : ''} from history.`
            : `Removed ${removedCount} item${removedCount !== 1 ? 's' : ''} from history.`;
        alert(message);
    }

    // Clear History button with confirmation
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
        clearHistoryBtn.onclick = () => {
            if (confirmDelete('Are you sure you want to clear all history?')) {
                localStorage.removeItem('ytdHistory');
                filterAndRenderHistory();
            }
        };
    }

    // History action buttons event listener
    document.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('.history-action-btn');
        if (!actionBtn) return;
        
        const action = actionBtn.dataset.action;
        const filePath = actionBtn.dataset.path;
        const index = parseInt(actionBtn.dataset.index);
        
        if (action === 'play') {
            if (window.electronAPI?.openPathInExplorer) {
                await window.electronAPI.openPathInExplorer(filePath);
            }
        } else if (action === 'folder') {
            if (window.electronAPI?.getDirname && window.electronAPI?.openPathInExplorer) {
                const folderPath = await window.electronAPI.getDirname(filePath);
                await window.electronAPI.openPathInExplorer(folderPath);
            }
        } else if (action === 'delete') {
            if (confirmDelete('Are you sure you want to delete this file?')) {
                try {
                    if (window.electronAPI?.deleteFile) {
                        const result = await window.electronAPI.deleteFile(filePath);
                        if (result.success) {
                            // Remove from history
                            const history = JSON.parse(localStorage.getItem('ytdHistory') || '[]');
                            const historyItem = actionBtn.closest('.history-item');
                            const originalIndex = parseInt(historyItem.dataset.originalIndex);
                            if (originalIndex >= 0 && originalIndex < history.length) {
                                history.splice(originalIndex, 1);
                                localStorage.setItem('ytdHistory', JSON.stringify(history));
                                filterAndRenderHistory();
                            }
                        } else {
                            alert('Failed to delete file: ' + (result.error || 'Unknown error'));
                        }
                    }
                } catch (error) {
                    console.error('Error deleting file:', error);
                    alert('Error deleting file: ' + error.message);
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
    activateHistoryTab('youtubePlaylists');
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
});

// Ensure default download folder is set to the full absolute path on first launch
window.addEventListener('DOMContentLoaded', async () => {
    const downloadFolderInput = document.getElementById('downloadFolder');
    const absoluteDefault = 'C:/Users/Youssef Ben/Desktop/Code/Video downloader Gemini (Complete) - Stable #2/downloads';
    if (downloadFolderInput) {
        let savedFolder = localStorage.getItem('downloadFolder');
        if (!savedFolder) {
            downloadFolderInput.value = absoluteDefault;
            localStorage.setItem('downloadFolder', absoluteDefault);
        } else {
            downloadFolderInput.value = savedFolder;
        }
    }
    // Update default folder button to use the absolute path
    const defaultFolderBtn = document.getElementById('defaultFolderBtn');
    if (defaultFolderBtn) {
        defaultFolderBtn.onclick = () => {
            const downloadFolderInput = document.getElementById('downloadFolder');
            if (downloadFolderInput) downloadFolderInput.value = absoluteDefault;
            localStorage.setItem('downloadFolder', absoluteDefault);
        };
    }
});