document.addEventListener('DOMContentLoaded', function() {
    const settingsRoot = document.getElementById('settings-root');
    let currentSettings = null;
    let currentOverrides = null;

    function getNestedValue(obj, path) {
        return path.split('.').reduce((curr, key) => {
            if (curr === null || curr === undefined) return null;
            const value = curr[key];
            if (Array.isArray(value)) {
                return value.join(',');
            }
            return value;
        }, obj);
    }

    function setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((curr, key) => {
            if (!(key in curr)) {
                curr[key] = {};
            }
            return curr[key];
        }, obj);

        if (path.includes('poster_users') && typeof value === 'string') {
            target[lastKey] = value.split(',').map(item => item.trim()).filter(Boolean);
        } else {
            target[lastKey] = value;
        }

        return obj;
    }

    function showMessage(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'info-message';
        messageDiv.textContent = message;
        settingsRoot.insertBefore(messageDiv, settingsRoot.firstChild);
        setTimeout(() => messageDiv.remove(), 3000);
    }

    function showError(message) {
        const error = document.createElement('div');
        error.className = 'error-message';
        error.textContent = message;
        settingsRoot.insertBefore(error, settingsRoot.firstChild);
        setTimeout(() => error.remove(), 3000);
    }

    function showSuccess(message) {
        const success = document.createElement('div');
        success.className = 'success-message';
        success.textContent = message;
        settingsRoot.insertBefore(success, settingsRoot.firstChild);
        setTimeout(() => success.remove(), 3000);
    }

    function createInput(type, value, disabled, onChange, placeholder = '') {
        const input = document.createElement('input');
        input.type = type;
        input.value = value || '';
        input.disabled = disabled;
        input.placeholder = placeholder;
        input.className = 'setting-input';
        if (!disabled) {
            input.addEventListener('change', (e) => onChange(e.target.value));
        }
        return input;
    }

    function createToggle(checked, disabled, isEnvEnabled, onChange) {
        const toggle = document.createElement('div');
        toggle.className = `toggle ${(checked || isEnvEnabled) ? 'active' : ''} ${disabled ? 'disabled' : ''}`;

        if (!disabled) {
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('active');
                onChange(toggle.classList.contains('active'));
            });
        } else {
            toggle.style.pointerEvents = 'none';
            toggle.title = 'This setting is controlled by environment variables';
        }

        return toggle;
    }

    async function handleSettingChange(key, value) {
    	try {
            if (currentOverrides && getNestedValue(currentOverrides, key)) {
                showError('Cannot modify environment-controlled setting');
                return;
            }

            if (key.includes('poster_users') && typeof value === 'string') {
                value = value.split(',').map(item => item.trim()).filter(Boolean);
            }

            const category = key.split('.')[0];
            const updateData = {};
            const keyParts = key.split('.');
            let current = updateData;

            for (let i = 1; i < keyParts.length - 1; i++) {
                current[keyParts[i]] = {};
                current = current[keyParts[i]];
            }
            current[keyParts[keyParts.length - 1]] = value;

            const response = await fetch(`/api/settings/${category}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update setting');
            }

            const result = await response.json();
            showSuccess('Setting updated successfully');
            setNestedValue(currentSettings, key, value);

        } catch (error) {
            console.error('Error updating setting:', error);
            showError(error.message || 'Failed to update setting');
        }
    }

    function createTraktIntegration(container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'trakt-integration-wrapper';

        const button = document.createElement('button');
        button.className = 'trakt-connect-button';

        async function updateButtonState(connected, loading = false, envControlled = false) {
            button.className = `trakt-connect-button ${connected ? 'connected' : ''} ${loading ? 'loading' : ''}`;
            if (loading) {
                button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>Processing...`;
                button.disabled = true;
            } else {
                button.innerHTML = `
                    <i class="fa-solid fa-${connected ? 'plug-circle-xmark' : 'plug'}"></i>
                    ${connected ? 'Disconnect from Trakt' : 'Connect Trakt Account'}
                `;
                button.disabled = envControlled;
                if (envControlled) {
                    const wrapper = button.closest('.trakt-integration-wrapper');
                    if (wrapper) {
                        const existingOverride = wrapper.querySelector('.env-override');
                        if (!existingOverride) {
                            const overrideIndicator = document.createElement('div');
                            overrideIndicator.className = 'env-override';
                            overrideIndicator.textContent = 'Set by environment variable';
                            wrapper.appendChild(overrideIndicator);
                        }
                    }
                    button.title = 'Trakt is configured via environment variables';
                } else {
                    const wrapper = button.closest('.trakt-integration-wrapper');
                    if (wrapper) {
                        const existingOverride = wrapper.querySelector('.env-override');
                        if (existingOverride) {
                            existingOverride.remove();
                        }
                    }
                    button.title = '';
                }
            }
        }

        async function checkConnectionStatus() {
            try {
                const response = await fetch('/trakt/status');
                if (response.ok) {
                    const data = await response.json();
                    updateButtonState(data.connected, false, data.env_controlled);
                    return data;
                }
            } catch (error) {
                console.error('Failed to check Trakt status:', error);
                showError('Failed to check Trakt connection status');
            }
            return { connected: false, env_controlled: false };
        }

        async function handleOAuthFlow(authUrl) {
            const codeDialog = document.createElement('div');
            codeDialog.className = 'trakt-confirm-dialog';
            codeDialog.innerHTML = `
                <div class="dialog-content">
                    <h3>Connect to Trakt</h3>
                    <div class="dialog-steps">
                        <p class="step current">1. Authorize Movie Roulette in the Trakt window</p>
                        <p class="step">2. Copy the code shown by Trakt</p>
                        <p class="step">3. Paste the code here and click Connect</p>
                    </div>
                    <input type="text"
                           class="setting-input code-input"
                           placeholder="Paste your authorization code here"
                           autocomplete="off"
                           spellcheck="false">
                    <div class="dialog-note">
                        <i class="fa-solid fa-info-circle"></i>
                        Paste the code from Trakt and click Connect. You can close the Trakt window after.
                    </div>
                    <div class="dialog-buttons">
                        <button class="cancel-button">Cancel</button>
                        <button class="submit-button" disabled>Connect</button>
                    </div>
                </div>
            `;

            document.body.appendChild(codeDialog);

            const popup = window.open(
                authUrl,
                'TraktAuth',
                'width=600,height=800'
            );

            if (!popup) {
                showError('Popup was blocked. Please allow popups for this site.');
                codeDialog.remove();
                updateButtonState(false, false);
                return;
            }

            const input = codeDialog.querySelector('.code-input');
            const submitButton = codeDialog.querySelector('.submit-button');
            const steps = codeDialog.querySelectorAll('.step');

            input.focus();

            input.addEventListener('input', () => {
                const hasValue = input.value.trim();
                submitButton.disabled = !hasValue;
                if (hasValue) {
                    steps[1].classList.remove('current');
                    steps[2].classList.add('current');
                } else {
                    steps[1].classList.add('current');
                    steps[2].classList.remove('current');
                }
            });

            const checkPopup = setInterval(() => {
                if (popup.closed) {
                    clearInterval(checkPopup);
                    const note = codeDialog.querySelector('.dialog-note');
                    note.innerHTML = '<i class="fa-solid fa-check-circle"></i> Trakt window closed. Click Connect when ready.';
                }
            }, 1000);

            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !submitButton.disabled) {
                    submitButton.click();
                }
            });

            function removeDialog() {
                if (!popup.closed) {
                    popup.close();
                }
                clearInterval(checkPopup);
                codeDialog.remove();
                updateButtonState(false, false);
            }

            codeDialog.addEventListener('click', (e) => {
                if (e.target === codeDialog) {
                    removeDialog();
                }
            });

            codeDialog.querySelector('.cancel-button').addEventListener('click', removeDialog);

            submitButton.addEventListener('click', async () => {
                const code = input.value.trim();
                if (!code) {
                    showError('Please enter the authorization code');
                    return;
                }

                updateButtonState(false, true);
                submitButton.disabled = true;
                submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';

                try {
                    const response = await fetch('/trakt/token', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ code })
                    });

                    const data = await response.json();
                    if (response.ok && data.status === 'success') {
                        showSuccess('Successfully connected to Trakt');
                        codeDialog.remove();
                        await checkConnectionStatus();
                    } else {
                        throw new Error(data.error || 'Failed to connect to Trakt');
                    }
                } catch (error) {
                    showError(error.message);
                    submitButton.disabled = false;
                    submitButton.textContent = 'Connect';
                    updateButtonState(false, false);
                }
            });
        }

        async function handleDisconnect() {
            const confirmDialog = document.createElement('div');
            confirmDialog.className = 'trakt-confirm-dialog';
            confirmDialog.innerHTML = `
                <div class="dialog-content">
                    <h3>Disconnect from Trakt?</h3>
                    <p>This will remove the connection between Movie Roulette and your Trakt account.
                       Your Trakt history and ratings will remain unchanged.</p>
                    <div class="dialog-buttons">
                        <button class="cancel-button">Cancel</button>
                        <button class="disconnect-button">Disconnect</button>
                    </div>
                </div>
            `;

            document.body.appendChild(confirmDialog);

            function removeDialog() {
                confirmDialog.remove();
            }

            confirmDialog.addEventListener('click', (e) => {
                if (e.target === confirmDialog) {
                    removeDialog();
                }
            });

            confirmDialog.querySelector('.cancel-button').addEventListener('click', removeDialog);

            confirmDialog.querySelector('.disconnect-button').addEventListener('click', async () => {
                updateButtonState(false, true);
                removeDialog();

                try {
                    const response = await fetch('/trakt/disconnect');
                    const data = await response.json();

                    if (!response.ok) {
                        if (data.status === 'env_controlled') {
                            showError('Cannot disconnect: Trakt is configured via environment variables');
                            updateButtonState(true, false, true);
                        } else {
                            throw new Error(data.error || 'Failed to disconnect');
                        }
                    } else if (data.status === 'success') {
                        showSuccess('Successfully disconnected from Trakt');
                        await checkConnectionStatus();
                    }
                } catch (error) {
                    showError(error.message || 'Failed to disconnect from Trakt');
                    await checkConnectionStatus();
                }
            });
        }

        button.addEventListener('click', async () => {
            const status = await checkConnectionStatus();

            if (status.env_controlled) {
                return;
            }

            if (status.connected) {
                handleDisconnect();
            } else {
                updateButtonState(false, true);

                try {
                    const response = await fetch('/trakt/authorize');
                    if (!response.ok) {
                        throw new Error('Failed to initialize Trakt authorization');
                    }

                    const data = await response.json();
                    if (!data.auth_url) {
                        throw new Error('Invalid authorization URL');
                    }

                    await handleOAuthFlow(data.auth_url);
                } catch (error) {
                    console.error('Trakt authorization error:', error);
                    showError(error.message || 'Failed to start Trakt authorization');
                    updateButtonState(false, false);
                }
            }
        });

        wrapper.appendChild(button);
        container.appendChild(wrapper);
        checkConnectionStatus();
    }

    function renderSettingsSection(title, settings, envOverrides, fields) {
    	console.log('Current envOverrides:', envOverrides);
    	const section = document.createElement('div');
    	section.className = 'settings-section';

    	const titleElem = document.createElement('h2');
    	titleElem.textContent = title;
    	section.appendChild(titleElem);

    	fields.forEach(field => {
            const fieldContainer = document.createElement('div');
            fieldContainer.className = 'setting-field';

            const label = document.createElement('label');
            label.textContent = field.label;
            fieldContainer.appendChild(label);

            if (field.key === 'trakt.connect') {
            	createTraktIntegration(fieldContainer);
            	section.appendChild(fieldContainer);
            	return;
            }

            if (field.type === 'custom' && typeof field.render === 'function') {
            	field.render(fieldContainer);
            	section.appendChild(fieldContainer);
            	return;
            }

            // Handle TMDB API key field
            if (field.key === 'tmdb.api_key') {
            	const isOverridden = Boolean(getNestedValue(envOverrides, 'tmdb.api_key'));
            	const tmdbEnabled = getNestedValue(settings, 'tmdb.enabled');

            	let input;
            	if (isOverridden) {
                    input = createInput(
                    	'password',
                    	getNestedValue(settings, 'tmdb.api_key'),
                    	true,
                    	() => {},
                    	''
                    );
                    input.setAttribute('data-field-key', 'tmdb.api_key');
                    // Add env override indicator
                    const overrideIndicator = document.createElement('div');
                    overrideIndicator.className = 'env-override';
                    overrideIndicator.textContent = 'Set by environment variable';
                    fieldContainer.appendChild(input);
                    fieldContainer.appendChild(overrideIndicator);
            	} else if (tmdbEnabled) {
                    // If custom TMDB is enabled, show editable input
                    input = createInput(
                    	'password',
                    	getNestedValue(settings, 'tmdb.api_key'),
                    	false,
                    	(value) => handleSettingChange(field.key, value),
                    	'Enter your TMDB API key'
                    );
                    input.setAttribute('data-field-key', 'tmdb.api_key');
                    fieldContainer.appendChild(input);
            	} else {
                    // If not enabled, show "Using built-in API key"
                    input = createInput(
                    	'text',
                    	'Using built-in API key',
                    	true,
                    	() => {},
                    	''
                    );
                    input.setAttribute('data-field-key', 'tmdb.api_key');
                    fieldContainer.appendChild(input);
            	}
            	section.appendChild(fieldContainer);
            	return;
            }

            const value = getNestedValue(settings, field.key);
            let isOverridden = getNestedValue(envOverrides, field.key);

            console.log(`Field ${field.key}:`, {
            	value,
            	isOverridden,
            	envOverrides: envOverrides
            });

            const isIntegrationToggle = (
            	field.key === 'overseerr.enabled' ||
            	field.key === 'trakt.enabled'
            );

            const isPlexEnv = Boolean(
            	getNestedValue(envOverrides, 'plex.url') &&
            	getNestedValue(envOverrides, 'plex.token') &&
            	getNestedValue(envOverrides, 'plex.movie_libraries')
            );
            const isJellyfinEnv = Boolean(
            	getNestedValue(envOverrides, 'jellyfin.url') &&
            	getNestedValue(envOverrides, 'jellyfin.api_key') &&
            	getNestedValue(envOverrides, 'jellyfin.user_id')
            );
            const isAppleTVEnv = getNestedValue(envOverrides, 'clients.apple_tv.id');
            const isLGTVEnv = getNestedValue(envOverrides, 'clients.lg_tv.ip') &&
                             getNestedValue(envOverrides, 'clients.lg_tv.mac');

            const isOverseerrEnv = Boolean(
            	getNestedValue(envOverrides, 'overseerr.url') &&
            	getNestedValue(envOverrides, 'overseerr.api_key')
            );
            const isTraktEnv = Boolean(
            	getNestedValue(envOverrides, 'trakt.client_id') &&
            	getNestedValue(envOverrides, 'trakt.client_secret') &&
            	getNestedValue(envOverrides, 'trakt.access_token') &&
            	getNestedValue(envOverrides, 'trakt.refresh_token')
            );

            let isEnvEnabled = false;
            const isServiceToggle = field.key === 'plex.enabled' || field.key === 'jellyfin.enabled';
            const isClientToggle = field.key === 'clients.apple_tv.enabled' ||
                                 field.key === 'clients.lg_tv.enabled';

            if (isServiceToggle || isClientToggle || isIntegrationToggle) {
            	switch (field.key) {
                    case 'plex.enabled':
                    	isOverridden = isPlexEnv;
                    	isEnvEnabled = isPlexEnv;
                    	break;
                    case 'jellyfin.enabled':
                    	isOverridden = isJellyfinEnv;
                    	isEnvEnabled = isJellyfinEnv;
                    	break;
                    case 'clients.apple_tv.enabled':
                    	isOverridden = isAppleTVEnv;
                    	isEnvEnabled = isAppleTVEnv;
                    	break;
                    case 'clients.lg_tv.enabled':
                    	isOverridden = isLGTVEnv;
                    	isEnvEnabled = isLGTVEnv;
                    	break;
                    case 'overseerr.enabled':
                    	isOverridden = isOverseerrEnv;
                    	isEnvEnabled = isOverseerrEnv;
                    	break;
                    case 'trakt.enabled':
                    	isOverridden = isTraktEnv;
                    	isEnvEnabled = isTraktEnv;
                    	break;
            	}
            }

            if (field.type === 'switch') {
            	if (field.key === 'tmdb.enabled') {
                    const isApiKeyOverridden = Boolean(getNestedValue(envOverrides, 'tmdb.api_key'));
                    const toggle = createToggle(
                    	isApiKeyOverridden || value,
                    	isApiKeyOverridden,
                    	isApiKeyOverridden,
                    	async (checked) => {
                            if (!isApiKeyOverridden) {
                            	await handleSettingChange(field.key, checked);
                            	// Find and update the API key input field
                            	const apiKeyField = section.querySelector('[data-field-key="tmdb.api_key"]')
                                    .closest('.setting-field');

                            	if (checked) {
                                    // Switch to editable password input
                                    const newInput = createInput(
                                    	'password',
                                    	getNestedValue(settings, 'tmdb.api_key'),
                                    	false,
                                    	(value) => handleSettingChange('tmdb.api_key', value),
                                    	'Enter your TMDB API key'
                                    );
                                    newInput.setAttribute('data-field-key', 'tmdb.api_key');
                                    apiKeyField.innerHTML = '';
                                    apiKeyField.appendChild(label.cloneNode(true));
                                    apiKeyField.appendChild(newInput);
                            	} else {
                                    // Switch back to disabled "Using built-in API key"
                                    const newInput = createInput(
                                    	'text',
                                    	'Using built-in API key',
                                    	true,
                                    	() => {},
                                    	''
                                    );
                                    newInput.setAttribute('data-field-key', 'tmdb.api_key');
                                    apiKeyField.innerHTML = '';
                                    apiKeyField.appendChild(label.cloneNode(true));
                                    apiKeyField.appendChild(newInput);
                            	}
                            }
                    	}
                    );
                    fieldContainer.appendChild(toggle);
            	} else {
                    const toggle = createToggle(
                    	value,
                    	isOverridden,
                    	isEnvEnabled,
                    	(checked) => handleSettingChange(field.key, checked)
                    );
                    fieldContainer.appendChild(toggle);
            	}
            } else if (field.key !== 'tmdb.api_key') {  // Skip if it's tmdb.api_key as we handled it above
            	const input = createInput(
                    field.type,
                    value,
                    isOverridden,
                    (value) => handleSettingChange(field.key, value),
                    field.placeholder
            	);
                fieldContainer.appendChild(input);
            }

            if (isOverridden &&
            	!isServiceToggle &&
            	!isClientToggle &&
            	!field.key.endsWith('.enabled')) {
            	const overrideIndicator = document.createElement('div');
            	overrideIndicator.className = 'env-override';
            	overrideIndicator.textContent = 'Set by environment variable';
            	fieldContainer.appendChild(overrideIndicator);
            }

            section.appendChild(fieldContainer);
    	});

    	return section;
    }

    // Create main container
    const container = document.createElement('div');
    container.className = 'settings-container';

    // Add header with back button and sponsor button
    const header = document.createElement('div');
    header.className = 'settings-header';
    header.innerHTML = `
    	<h1>Settings</h1>
    	<div class="header-controls">
            <div class="dropdown">
	        <a class="donate-button">Sponsor<i class="fa-solid fa-chevron-down"></i></a>
                <div class="dropdown-content">
                    <a href="https://github.com/sponsors/sahara101"
                       target="_blank"
                       rel="noopener noreferrer">
                        <i class="fa-brands fa-github"></i>
                        GitHub
                    </a>
                    <a href="https://ko-fi.com/sahara101/donate"
                       target="_blank"
                       rel="noopener noreferrer">
                        <i class="fa-solid fa-mug-hot"></i>
                        Ko-fi
                    </a>
                </div>
            </div>
             <a href="/" class="back-button">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                Back to Movies
            </a>
        </div>
    `;
    container.appendChild(header);

    // Create tabs
    const tabs = document.createElement('div');
    tabs.className = 'settings-tabs';
    tabs.innerHTML = `
        <button class="tab" data-tab="media">Media Servers</button>
        <button class="tab" data-tab="clients">Clients</button>
        <button class="tab" data-tab="features">Features</button>
        <button class="tab" data-tab="integrations">Integrations</button>
    `;
    container.appendChild(tabs);

    // Create content container
    const contentContainer = document.createElement('div');
    contentContainer.className = 'settings-content';
    container.appendChild(contentContainer);

    // Add the container to the root
    settingsRoot.appendChild(container);

    // Define sections configuration
    const sections = {
        media: {
            title: 'Media Servers',
            sections: [
                {
                    title: 'Plex Configuration',
                    fields: [
                        { key: 'plex.enabled', label: 'Enable Plex', type: 'switch' },
                        { key: 'plex.url', label: 'Plex URL', type: 'text' },
			{
            		    key: 'plex.token_config',
            		    label: 'Plex Token',
            		    type: 'custom',
            		    render: renderPlexTokenConfig
        		},
			{
            		    key: 'plex.libraries_config',
            		    label: 'Movie Libraries',
            		    type: 'custom',
            		    render: renderPlexLibrariesConfig
        		}
                    ]
                },
                {
                    title: 'Jellyfin Configuration',
                    fields: [
                        { key: 'jellyfin.enabled', label: 'Enable Jellyfin', type: 'switch' },
                        { key: 'jellyfin.url', label: 'Jellyfin URL', type: 'text' },
			{
            		    key: 'jellyfin.auth_config',
            		    label: 'Authentication',
            		    type: 'custom',
            		    render: renderJellyfinAuthConfig
        		}
                    ]
                }
            ]
        },
        clients: {
            title: 'Client Devices',
            fields: [
                { key: 'clients.apple_tv.enabled', label: 'Enable Apple TV', type: 'switch' },
                {
                    key: 'clients.apple_tv.configuration',
                    label: 'Apple TV Configuration',
                    type: 'custom',
                    render: renderAppleTVConfig
                },
                { key: 'clients.lg_tv.enabled', label: 'Enable LG TV', type: 'switch' },
                {
                    key: 'clients.lg_tv.configuration',
                    label: 'LG TV Configuration',
                    type: 'custom',
                    render: renderLGTVConfig
                }
            ]
        },
        features: {
            title: 'Features',
            sections: [
                {
                    title: 'General Features',
                    fields: [
                        { key: 'features.use_links', label: 'Enable Links', type: 'switch' },
                        { key: 'features.use_filter', label: 'Enable Filters', type: 'switch' },
                        { key: 'features.use_watch_button', label: 'Enable Watch Button', type: 'switch' },
                        { key: 'features.use_next_button', label: 'Enable Next Button', type: 'switch' },
                        { key: 'features.homepage_mode', label: 'Homepage Mode', type: 'switch' }
                    ]
                },
                {
                    title: 'Poster Settings',
                    fields: [
			{
                    	    key: 'features.timezone',
                    	    label: 'Timezone',
                    	    type: 'custom',
                    	    render: renderTimezoneFieldWithButton
                	},
                        { key: 'features.default_poster_text', label: 'Default Poster Text', type: 'text' },
			{
            		    key: 'features.poster_users.plex',
            		    label: 'Plex Poster Users',
            		    type: 'custom',
            		    render: renderPlexUserSelector
        		},
        		{
            		    key: 'features.poster_users.jellyfin',
            		    label: 'Jellyfin Poster Users',
            		    type: 'custom',
            		    render: renderJellyfinUserSelector
        		}
                    ]
                }
            ]
        },
        integrations: {
            title: 'Integrations',
            sections: [
		{
            	    title: 'TMDB',
            	    fields: [
                	{
                    	    key: 'tmdb.enabled',
                    	    label: 'Use Custom TMDB API Key',
                    	    type: 'switch'
                	},
                	{
                    	    key: 'tmdb.api_key',
                    	    label: 'TMDB API Key (Optional)',
                    	    type: 'dynamic',
                    	    placeholder: 'Using built-in API key'
                	}
            	    ]
        	},
                {
                    title: 'Overseerr',
                    fields: [
                        { key: 'overseerr.enabled', label: 'Enable Overseerr', type: 'switch' },
                        { key: 'overseerr.url', label: 'Overseerr URL', type: 'text' },
                        { key: 'overseerr.api_key', label: 'API Key', type: 'password' },
                    ]
                },
                {
                    title: 'Trakt',
                    fields: [
			{ key: 'trakt.enabled', label: 'Enable Trakt', type: 'switch' },
                        { key: 'trakt.connect', label: 'Trakt Connection', type: 'custom' }
                    ]
                }
            ]
        }
    };

    // Define the renderAppleTVConfig function separately
    function renderAppleTVConfig(container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'appletv-setup-wrapper';

        // Check if controlled by ENV
        const isEnvControlled = Boolean(
            getNestedValue(currentOverrides, 'clients.apple_tv.id')
        );

        if (isEnvControlled) {
            // Show ENV override message
            const overrideIndicator = document.createElement('div');
            overrideIndicator.className = 'env-override';
            overrideIndicator.textContent = 'Set by environment variable';
            wrapper.appendChild(overrideIndicator);
        } else {
            // Create scan button
            const scanButton = document.createElement('button');
            scanButton.className = 'discover-button';
            scanButton.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Configure Apple TV';

            scanButton.addEventListener('click', async () => {
                try {
                    scanButton.disabled = true;
                    scanButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';

                    const response = await fetch('/api/appletv/scan');
                    const data = await response.json();

                    showConfigDialog(data.devices || []);
                } catch (error) {
                    console.error('Scan error:', error);
                    showError(error.message || 'Failed to scan for Apple TVs');
                    showConfigDialog([]);
                } finally {
                    scanButton.disabled = false;
                    scanButton.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Configure Apple TV';
                }
            });

            wrapper.appendChild(scanButton);
        }

        // Show current configuration if it exists and check credentials
        checkCurrentConfig().then(configDisplay => {
            if (configDisplay) {
                wrapper.appendChild(configDisplay);
            }
        });

        container.appendChild(wrapper);

        // Helper functions
        async function checkCurrentConfig() {
            const currentId = getNestedValue(currentSettings, 'clients.apple_tv.id');
            if (currentId) {
                try {
                    const response = await fetch('/api/appletv/check_credentials', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ device_id: currentId })
                    });
                    const data = await response.json();

                    if (data.has_credentials) {
                        const configDisplay = document.createElement('div');
                        configDisplay.className = 'current-config';
                        configDisplay.innerHTML = `
                            <div class="config-item">Device ID: ${currentId}</div>
                        `;
                        return configDisplay; // Return the element to be appended
                    }
                } catch (error) {
                    console.error('Error checking device credentials:', error);
                }
            }
            return null;
        }

        function showConfigDialog(devices) {
            const dialog = document.createElement('div');
            dialog.className = 'trakt-confirm-dialog';

            let dialogContent = `
                <div class="dialog-content">
                    <h3><i class="fa-brands fa-apple"></i> Apple TV Configuration</h3>`;

            if (devices.length > 0) {
                dialogContent += `
                    <div class="dialog-section">
                        <h4>Found Devices</h4>
                        <div class="device-list">
                            ${devices.map((device, index) => `
                                <button class="device-option" data-id="${device.identifier}">
                                    <i class="fa-brands fa-apple"></i>
                                    <div class="device-details">
                                        <div class="device-name">${device.name || `Apple TV ${index + 1}`}</div>
                                        <div class="device-info">ID: ${device.identifier}</div>
                                        ${device.model ? `<div class="device-model">${device.model}</div>` : ''}
                                    </div>
                                </button>
                            `).join('')}
                        </div>
                        <div class="dialog-separator">
                            <span>or enter manually</span>
                        </div>
                    </div>`;
            } else {
                dialogContent += `
                    <div class="scan-notice">
                        <i class="fa-solid fa-info-circle"></i>
                        <p>No Apple TVs found automatically. This could be because:</p>
                        <ul>
                            <li>The Apple TV is not powered on</li>
                            <li>The Apple TV is not connected to the network</li>
                            <li>The Apple TV is on a different subnet</li>
                        </ul>
                        <p>You can enter the Device ID manually below:</p>
                    </div>`;
            }

            dialogContent += `
                <div class="manual-input-group">
                    <label>Device ID</label>
                    <input type="text" class="setting-input" id="manual-id"
                           placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
                </div>
                <div class="dialog-buttons">
                    <button class="cancel-button">Cancel</button>
                    <button class="submit-button">Start Pairing</button>
                </div>
            </div>`;

            dialog.innerHTML = dialogContent;
            document.body.appendChild(dialog);

            // Handle device selection
            dialog.querySelectorAll('.device-option').forEach(button => {
                button.addEventListener('click', () => {
                    const id = button.dataset.id;
                    dialog.querySelector('#manual-id').value = id;
                });
            });

            // Handle start pairing
            dialog.querySelector('.submit-button').addEventListener('click', async () => {
                const id = dialog.querySelector('#manual-id').value.trim();
                if (!id) {
                    showError('Please enter a Device ID');
                    return;
                }

                try {
                    const submitButton = dialog.querySelector('.submit-button');
                    submitButton.disabled = true;
                    submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Starting pairing...';

                    // Start pairing process
                    const pairResponse = await fetch(`/api/appletv/pair/${id}`);
                    const pairData = await pairResponse.json();

                    if (pairData.status === 'awaiting_pin') {
                        submitButton.disabled = false;
                        submitButton.innerHTML = 'Start Pairing';
                        dialog.remove();
                        // Show PIN input dialog
                        setTimeout(() => showPinDialog(id), 100);
                    } else {
                        throw new Error(pairData.message || 'Failed to start pairing');
                    }
                } catch (error) {
                    const submitButton = dialog.querySelector('.submit-button');
                    submitButton.disabled = false;
                    submitButton.innerHTML = 'Start Pairing';
                    showError(error.message);
                }
            });

            // Handle cancel
            dialog.querySelector('.cancel-button').addEventListener('click', () => {
                dialog.remove();
            });
        }

        function showPinDialog(deviceId) {
            const dialog = document.createElement('div');
            dialog.className = 'trakt-confirm-dialog pin-input-dialog';
            dialog.innerHTML = `
                <div class="dialog-content">
                    <h3><i class="fa-brands fa-apple"></i> Enter PIN</h3>
                    <p>Enter the PIN shown on your Apple TV:</p>
                    <div class="pin-input">
                        <input type="text"
                           class="setting-input pin-code"
                           maxlength="4" placeholder="0000"
                           pattern="[0-9]*"
                           inputmode="numeric">
                    </div>
                    <div class="dialog-buttons">
                        <button class="cancel-button">Cancel</button>
                        <button class="submit-button" disabled>Submit PIN</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            const pinInput = dialog.querySelector('.pin-code');
            const submitButton = dialog.querySelector('.submit-button');

            // Focus the PIN input after dialog is shown
            setTimeout(() => pinInput.focus(), 100);

            // Handle PIN input
            pinInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');
                submitButton.disabled = e.target.value.length !== 4;
            });

            // Handle PIN submission
            submitButton.addEventListener('click', async () => {
                const pin = pinInput.value;
                if (pin.length !== 4) {
                    showError('Please enter a 4-digit PIN');
                    return;
                }

                submitButton.disabled = true;
                submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Pairing...';

                try {
                    const response = await fetch(`/api/appletv/pin/${deviceId}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ pin })
                    });

                    const data = await response.json();
                    if (data.status === 'success') {
                        await handleSettingChange('clients.apple_tv.id', deviceId);
                        await handleSettingChange('clients.apple_tv.enabled', true);
                        showSuccess('Apple TV configured successfully');
                        dialog.remove();
                    } else if (data.status === 'awaiting_pin') {
                        // Clear the input and get ready for next PIN
                        pinInput.value = '';
                        pinInput.focus();
                        submitButton.disabled = true;
                        submitButton.innerHTML = 'Submit PIN';
                        showMessage('Please enter the new PIN shown on your Apple TV');
                    } else {
                        throw new Error(data.message || 'Pairing failed');
                    }
                } catch (error) {
                    showError(error.message);
                    submitButton.disabled = false;
                    submitButton.innerHTML = 'Submit PIN';
                    pinInput.value = '';
                    pinInput.focus();
                }
            });

            // Handle cancel
            dialog.querySelector('.cancel-button').addEventListener('click', async () => {
                await fetch(`/api/appletv/cancel/${deviceId}`);
                dialog.remove();
            });

            // Handle Enter key
            pinInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !submitButton.disabled) {
                    submitButton.click();
                }
            });

            pinInput.focus();
        }
    }

    // Define the renderLGTVConfig function
    function renderLGTVConfig(container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'lgtv-setup-wrapper';

        // Check if controlled by ENV
        const isEnvControlled = Boolean(
            getNestedValue(currentOverrides, 'clients.lg_tv.ip') ||
            getNestedValue(currentOverrides, 'clients.lg_tv.mac')
        );

        if (isEnvControlled) {
            // Show ENV override message
            const overrideIndicator = document.createElement('div');
            overrideIndicator.className = 'env-override';
            overrideIndicator.textContent = 'Set by environment variable';
            wrapper.appendChild(overrideIndicator);
        } else {
            // Create find TV button
            const findButton = document.createElement('button');
            findButton.className = 'discover-button';
            findButton.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Configure TV';

            findButton.addEventListener('click', async () => {
                try {
                    findButton.disabled = true;
                    findButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';

                    const response = await fetch('/api/lgtv/scan');
                    const data = await response.json();

                    // Always show the dialog, but with scan results if any
                    showConfigDialog(data.devices || []);
                } catch (error) {
                    console.error('Scan error:', error);
                    showConfigDialog([]);
                } finally {
                    findButton.disabled = false;
                    findButton.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Configure TV';
                }
            });

            function showConfigDialog(foundDevices) {
                const dialog = document.createElement('div');
                dialog.className = 'trakt-confirm-dialog';

                let dialogContent = `
                    <div class="dialog-content">
                        <h3>LG TV Configuration</h3>`;

                // If devices were found, show them
                if (foundDevices.length > 0) {
                    dialogContent += `
                        <div class="dialog-section">
                            <h4>Found TVs</h4>
                            <div class="tv-list">
                                ${foundDevices.map((device, index) => `
                                    <button class="tv-option" data-ip="${device.ip}" data-mac="${device.mac}">
                                        <i class="fa-solid fa-tv"></i>
                                        <div class="tv-details">
                                            <div class="tv-name">LG TV ${index + 1}</div>
                                            <div class="tv-info">
                                                <div>IP: ${device.ip}</div>
                                                <div>MAC: ${device.mac}</div>
                                            </div>
                                        </div>
                                    </button>
                                `).join('')}
                            </div>
                            <div class="dialog-separator">
                                <span>or enter manually</span>
                            </div>
                        </div>`;
                } else {
                    dialogContent += `
                        <div class="scan-notice">
                            <i class="fa-solid fa-info-circle"></i>
                            <p>No TVs were found automatically. This could be because:</p>
                            <ul>
                                <li>The TV is turned off</li>
                                <li>The TV is not connected to the network</li>
                                <li>The TV is on a different subnet</li>
                            </ul>
                            <p>You can enter the TV details manually below:</p>
                        </div>`;
                }
                dialogContent += `
                    <div class="manual-input-group">
                        <label>IP Address</label>
                        <input type="text" class="setting-input" id="manual-ip" placeholder="192.168.1.100">
                        <label>MAC Address</label>
                        <input type="text" class="setting-input" id="manual-mac" placeholder="00:00:00:00:00:00">
                    </div>
                    <div class="dialog-buttons">
                        <button class="cancel-button">Cancel</button>
                        <button class="submit-button">Save Configuration</button>
                    </div>
                </div>`;

                dialog.innerHTML = dialogContent;
                document.body.appendChild(dialog);

                // Handle auto-fill from found devices
                dialog.querySelectorAll('.tv-option').forEach(button => {
                    button.addEventListener('click', () => {
                        const ip = button.dataset.ip;
                        const mac = button.dataset.mac;
                        dialog.querySelector('#manual-ip').value = ip;
                        dialog.querySelector('#manual-mac').value = mac;
                    });
                });

                // MAC address formatting
                const macInput = dialog.querySelector('#manual-mac');
                macInput.addEventListener('input', (e) => {
                    let value = e.target.value.replace(/[^0-9a-fA-F]/g, '');
                    if (value.length > 12) value = value.slice(0, 12);
                    const formatted = value.match(/.{1,2}/g)?.join(':') || value;
                    macInput.value = formatted.toUpperCase();
                });

                // Handle save
                dialog.querySelector('.submit-button').addEventListener('click', async () => {
		    const submitButton = dialog.querySelector('.submit-button');
                    const ip = dialog.querySelector('#manual-ip').value.trim();
                    const mac = dialog.querySelector('#manual-mac').value.trim();

                    try {
			// Disable button and show loading state
        		submitButton.disabled = true;
        		submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

                        const response = await fetch(`/api/lgtv/validate?ip=${encodeURIComponent(ip)}&mac=${encodeURIComponent(mac)}`);
                        const data = await response.json();

                        if (response.ok) {
                            await handleSettingChange('clients.lg_tv.ip', ip);
                            await handleSettingChange('clients.lg_tv.mac', mac);
                            showSuccess('TV configured successfully');
                            dialog.remove();
                        } else {
                            throw new Error(data.error || 'Invalid IP or MAC address');
                        }
                    } catch (error) {
                        showError(error.message);
			// Reset button state on error
        		submitButton.disabled = false;
        		submitButton.innerHTML = 'Save Configuration';
                    }
                });

                // Handle cancel
                dialog.querySelector('.cancel-button').addEventListener('click', () => {
                    dialog.remove();
                });
            }

            wrapper.appendChild(findButton);
        }

        // Show current configuration if it exists
        const currentIP = getNestedValue(currentSettings, 'clients.lg_tv.ip');
        const currentMAC = getNestedValue(currentSettings, 'clients.lg_tv.mac');

        if (currentIP && currentMAC) {
            const configDisplay = document.createElement('div');
            configDisplay.className = 'current-config';
            configDisplay.innerHTML = `
                <div class="config-item">IP: ${currentIP}</div>
                <div class="config-item">MAC: ${currentMAC}</div>
            `;
            wrapper.appendChild(configDisplay);
        }

        container.appendChild(wrapper);
    }

    // Add tab click event listener
    tabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab')) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            e.target.classList.add('active');
            loadTabContent(e.target.dataset.tab);
        }
    });

    // Initialize the page
    function loadTabContent(tabName) {
        const section = sections[tabName];
        if (!section) return;

        contentContainer.innerHTML = '';

        if (section.sections) {
            // Multiple sections under this tab
            section.sections.forEach(subSection => {
                contentContainer.appendChild(renderSettingsSection(
                    subSection.title,
                    currentSettings,
                    currentOverrides,
                    subSection.fields
                ));
            });
        } else {
            // Single section
            contentContainer.appendChild(renderSettingsSection(
                section.title,
                currentSettings,
                currentOverrides,
                section.fields
            ));
        }
    }

    async function initialize() {
    	try {
            const response = await fetch('/api/settings');
            if (!response.ok) throw new Error('Failed to load settings');
            const data = await response.json();

            currentSettings = data.settings;
            currentOverrides = data.env_overrides;

            // Check if any services are configured
            const plexEnabled = currentSettings.plex?.enabled;
            const jellyfinEnabled = currentSettings.jellyfin?.enabled;

            if (!plexEnabled && !jellyfinEnabled) {
            	// Show message in the Media Servers tab
            	const contentContainer = document.querySelector('.settings-content');
            	if (contentContainer) {
                    const message = document.createElement('div');
                    message.className = 'setup-message';
                    message.innerHTML = `
                    	<div class="setup-welcome">
                            <h2>Welcome to Movie Roulette!</h2>
                            <p>To get started, you'll need to configure at least one media server.</p>
                            <p>Configure Plex, Jellyfin or both below to start using Movie Roulette.</p>
                    	</div>
                    `;
                    contentContainer.insertBefore(message, contentContainer.firstChild);

                    // Automatically switch to media servers tab
                    document.querySelector('[data-tab="media"]').click();
            	}
            } else {
            	// Load the initial tab (media by default)
            	document.querySelector('[data-tab="media"]').classList.add('active');
            	loadTabContent('media');
            }

            // Handle back button navigation
            const backButton = document.querySelector('.back-button');
            if (backButton) {
            	backButton.addEventListener('click', async (e) => {
                    e.preventDefault(); // Prevent immediate navigation

                    try {
                    	// Check if cache exists
                    	const response = await fetch('/debug_plex');
                    	const data = await response.json();

                    	if (!data.cache_file_exists) {
                            // Show loading overlay
                            const loadingOverlay = document.createElement('div');
                            loadingOverlay.id = 'loading-overlay';
                            loadingOverlay.className = 'cache-building';
                            loadingOverlay.innerHTML = `
                            	<div id="loading-content" class="custom-loading">
                                    <h3>Building Movie Library</h3>
                                    <div class="loading-text">Loading movies: <span class="loading-count">0/0</span></div>
                                    <div id="loading-bar-container">
                                    	<div id="loading-progress"></div>
                                    </div>
                            	</div>
                            `;
                            document.body.appendChild(loadingOverlay);

                            // Start cache building and wait for completion
                            const socket = io();

                            socket.on('loading_progress', (data) => {
                            	const progressBar = document.getElementById('loading-progress');
                            	const loadingCount = document.querySelector('.loading-count');

                            	if (progressBar && loadingCount) {
                                    progressBar.style.width = `${data.progress * 100}%`;
                                    loadingCount.textContent = `${data.current}/${data.total}`;
                            	}
                            });

                            socket.on('loading_complete', () => {
                            	// Navigate to movies page after cache is built
                            	window.location.href = '/';
                            });

                            // Trigger cache building
                            await fetch('/start_loading');
                    	} else {
                            // Cache exists, navigate immediately
                            window.location.href = '/';
                        }
                    } catch (error) {
                    	console.error('Error checking cache status:', error);
                    	// On error, just navigate
                    	window.location.href = '/';
                    }
            	});
            }

            // Add mobile-specific dropdown functionality
            if (window.innerWidth <= 640) {
            	const dropdown = document.querySelector('.dropdown');

            	if (dropdown) {
                    dropdown.addEventListener('click', function(e) {
                    	console.log('Dropdown clicked', e.target);
                    	console.log('Matches:', e.target.matches('.donate-button, .donate-button *'));
                    	if (e.target.matches('.donate-button, .donate-button *')) {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('Before toggle:', this.classList.contains('active'));
                            this.classList.toggle('active');
                            console.log('After toggle:', this.classList.contains('active'));
                    	}
                    });

                    document.addEventListener('click', function(e) {
                    	console.log('Document clicked', e.target);
                    	console.log('Contains:', dropdown.contains(e.target));
                    	if (!dropdown.contains(e.target)) {
                            dropdown.classList.remove('active');
                    	}
                    });
            	}
            }

    	} catch (error) {
            console.error('Error loading settings:', error);
            showError('Failed to load settings');
    	}
    }

    function showPinDialog(pin) {
        const dialog = document.createElement('div');
        dialog.className = 'trakt-confirm-dialog';
        dialog.innerHTML = `
            <div class="dialog-content">
                <h3><i class="fa-brands fa-plex"></i> Enter PIN on Plex.tv</h3>
                <p>Enter this PIN on the Plex website:</p>
                <div class="pin-display">
                    <span class="pin-code">${pin}</span>
                </div>
                <p class="pin-instructions">A Plex.tv tab has been opened. Enter this PIN there to link Movie Roulette.</p>
                <div class="dialog-buttons">
                    <button class="cancel-button">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // Handle cancel
        dialog.querySelector('.cancel-button').addEventListener('click', () => {
            dialog.remove();
        });

        return dialog;
    }

    function renderPlexTokenConfig(container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'plex-token-wrapper';

        // Check if controlled by ENV
        const isEnvControlled = Boolean(
            getNestedValue(currentOverrides, 'plex.token')
        );

        if (isEnvControlled) {
            const overrideIndicator = document.createElement('div');
            overrideIndicator.className = 'env-override';
            overrideIndicator.textContent = 'Set by environment variable';
            wrapper.appendChild(overrideIndicator);
        } else {
            // Create token input and get token button
            const inputGroup = document.createElement('div');
            inputGroup.className = 'input-group';

            const tokenInput = createInput(
                'password',
                getNestedValue(currentSettings, 'plex.token'),
                false,
                (value) => handleSettingChange('plex.token', value),
                'Enter your Plex token'
            );

            const getTokenButton = document.createElement('button');
            getTokenButton.className = 'discover-button';
            getTokenButton.innerHTML = '<i class="fa-solid fa-key"></i> Get Token';

            getTokenButton.addEventListener('click', async () => {
                try {
                    const plexUrl = getNestedValue(currentSettings, 'plex.url');
                    if (!plexUrl) {
                        showError('Please enter Plex URL first');
                        return;
                    }

                    getTokenButton.disabled = true;
                    getTokenButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Getting token...';

                    const response = await fetch('/api/plex/get_token', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        throw new Error('Failed to initiate Plex authentication');
                    }

                    const data = await response.json();
		    console.log("Auth data received:", data);

                    const authWindow = window.open(
                        data.auth_url,
                        'PlexAuth',
			'width=800,height=600,location=yes,status=yes,scrollbars=yes'
                    );

                    if (!authWindow) {
                        throw new Error('Popup was blocked. Please allow popups for this site.');
                    }

   		    // Show PIN dialog
        	    const pinDialog = showPinDialog(data.pin);

		    let attempts = 0;
        	    const maxAttempts = 60;

                    // Check for auth completion
                    const checkAuth = setInterval(async () => {
                        try {
			    if (attempts >= maxAttempts) {
				clearInterval(checkAuth);
                    		authWindow.close();
                    		throw new Error('Authentication timed out');
			    }

			    attempts++;

			    const statusResponse = await fetch(`/api/plex/check_auth/${data.client_id}`);
                            const statusData = await statusResponse.json();

			    console.log("Status check:", statusData);

                            if (statusData.token) {
                                clearInterval(checkAuth);
                                authWindow.close();
                                await handleSettingChange('plex.token', statusData.token);
                                tokenInput.value = statusData.token;
                                showSuccess('Successfully got Plex token');
                            }
                        } catch (error) {
                            console.error('Auth check error:', error);
			    if (error.message !== 'Authentication timed out') {
                    		clearInterval(checkAuth);
                    		showError(error.message);
			    }
                        }
                    }, 2000);

                    // Clear interval if window is closed
                    const windowCheck = setInterval(() => {
                        if (authWindow.closed) {
                            clearInterval(checkAuth);
                            clearInterval(windowCheck);
			    pinDialog.remove();
                            getTokenButton.disabled = false;
                            getTokenButton.innerHTML = '<i class="fa-solid fa-key"></i> Get Token';
                        }
                    }, 1000);

                } catch (error) {
                    showError(error.message);
                } finally {
                    getTokenButton.disabled = false;
                    getTokenButton.innerHTML = '<i class="fa-solid fa-key"></i> Get Token';
                }
            });

            inputGroup.appendChild(tokenInput);
            wrapper.appendChild(inputGroup);
            wrapper.appendChild(getTokenButton);
        }

        container.appendChild(wrapper);
    }

    function renderPlexLibrariesConfig(container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'plex-libraries-wrapper';

        // Check if controlled by ENV
        const isEnvControlled = Boolean(
            getNestedValue(currentOverrides, 'plex.movie_libraries')
        );

        if (isEnvControlled) {
            const overrideIndicator = document.createElement('div');
            overrideIndicator.className = 'env-override';
            overrideIndicator.textContent = 'Set by environment variable';
            wrapper.appendChild(overrideIndicator);
        } else {
            // Create libraries input and fetch button
            const inputGroup = document.createElement('div');
            inputGroup.className = 'input-group';

            const librariesInput = createInput(
                'text',
                getNestedValue(currentSettings, 'plex.movie_libraries'),
                false,
                (value) => handleSettingChange('plex.movie_libraries', value),
                'Comma-separated library names'
            );

            const fetchButton = document.createElement('button');
            fetchButton.className = 'discover-button';
            fetchButton.innerHTML = '<i class="fa-solid fa-sync"></i> Fetch Libraries';

            fetchButton.addEventListener('click', async () => {
                try {
                    const plexUrl = getNestedValue(currentSettings, 'plex.url');
                    const plexToken = getNestedValue(currentSettings, 'plex.token');

                    if (!plexUrl || !plexToken) {
                        showError('Please configure Plex URL and token first');
                        return;
                    }

                    fetchButton.disabled = true;
                    fetchButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching...';

                    const response = await fetch('/api/plex/libraries', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            plex_url: plexUrl,
                            plex_token: plexToken
                        })
                    });

                    if (!response.ok) {
                        throw new Error('Failed to fetch libraries');
                    }

                    const data = await response.json();

                    // Show library selection dialog
                    showLibraryDialog(data.libraries, librariesInput);

                } catch (error) {
                    showError(error.message);
                } finally {
                    fetchButton.disabled = false;
                    fetchButton.innerHTML = '<i class="fa-solid fa-sync"></i> Fetch Libraries';
                }
            });

            inputGroup.appendChild(librariesInput);
            wrapper.appendChild(inputGroup);
            wrapper.appendChild(fetchButton);
        }

        container.appendChild(wrapper);
    }

    function showLibraryDialog(libraries, inputElement) {
        const dialog = document.createElement('div');
        dialog.className = 'trakt-confirm-dialog';

        const currentLibraries = inputElement.value.split(',').map(lib => lib.trim());

        dialog.innerHTML = `
            <div class="dialog-content">
                <h3>Select Movie Libraries</h3>
                <div class="library-select">
                    ${libraries.map(library => `
                        <label class="library-option">
                            <input type="checkbox" value="${library}"
                                ${currentLibraries.includes(library) ? 'checked' : ''}>
                            <span>${library}</span>
                        </label>
                    `).join('')}
                </div>
                <div class="dialog-buttons">
                    <button class="cancel-button">Cancel</button>
                    <button class="submit-button">Save Selection</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // Handle save
        dialog.querySelector('.submit-button').addEventListener('click', async () => {
            const selectedLibraries = Array.from(dialog.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value);

            await handleSettingChange('plex.movie_libraries', selectedLibraries.join(','));
            inputElement.value = selectedLibraries.join(',');
            dialog.remove();
        });

        // Handle cancel
        dialog.querySelector('.cancel-button').addEventListener('click', () => {
            dialog.remove();
        });
    }

    function renderJellyfinAuthConfig(container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'jellyfin-auth-wrapper';

        // Check if controlled by ENV
        const isEnvControlled = Boolean(
            getNestedValue(currentOverrides, 'jellyfin.api_key') ||
            getNestedValue(currentOverrides, 'jellyfin.user_id')
        );

        if (isEnvControlled) {
            const overrideIndicator = document.createElement('div');
            overrideIndicator.className = 'env-override';
            overrideIndicator.textContent = 'Set by environment variable';
            wrapper.appendChild(overrideIndicator);
        } else {
            // Create the manual input fields
            const manualGroup = document.createElement('div');
            manualGroup.className = 'input-group';

            const apiKeyInput = createInput(
                'password',
                getNestedValue(currentSettings, 'jellyfin.api_key'),
                false,
                (value) => handleSettingChange('jellyfin.api_key', value),
                'API Key'
            );

            const userIdInput = createInput(
                'text',
                getNestedValue(currentSettings, 'jellyfin.user_id'),
                false,
                (value) => handleSettingChange('jellyfin.user_id', value),
                'User ID'
            );

            manualGroup.appendChild(createLabel('API Key (manual entry)'));
            manualGroup.appendChild(apiKeyInput);
            manualGroup.appendChild(createLabel('User ID (manual entry)'));
            manualGroup.appendChild(userIdInput);

            // Add separator
            const separator = document.createElement('div');
            separator.className = 'dialog-separator';
            separator.innerHTML = '<span>or get automatically</span>';

            // Create the automatic login group
            const autoGroup = document.createElement('div');
            autoGroup.className = 'input-group';

            const usernameInput = createInput(
                'text',
                '',
                false,
                null,
                'Jellyfin username'
            );
            const passwordInput = createInput(
                'password',
                '',
                false,
                null,
                'Jellyfin password'
            );

            const loginButton = document.createElement('button');
            loginButton.className = 'discover-button';
            loginButton.innerHTML = '<i class="fa-solid fa-key"></i> Get API Key & User ID';

            loginButton.addEventListener('click', async () => {
                try {
                    const jellyfinUrl = getNestedValue(currentSettings, 'jellyfin.url');
                    if (!jellyfinUrl) {
                        showError('Please enter Jellyfin URL first');
                        return;
                    }

                    const username = usernameInput.value;
                    const password = passwordInput.value;

                    if (!username || !password) {
                        showError('Please enter both username and password');
                        return;
                    }

                    loginButton.disabled = true;
                    loginButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';

                    const response = await fetch('/api/jellyfin/auth', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            server_url: jellyfinUrl,
                            username: username,
                            password: password
                        })
                    });

                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(data.error || 'Failed to authenticate');
                    }

                    // Update both the manual inputs and the settings
                    apiKeyInput.value = data.api_key;
                    userIdInput.value = data.user_id;
                    await handleSettingChange('jellyfin.api_key', data.api_key);
                    await handleSettingChange('jellyfin.user_id', data.user_id);

                    // Clear sensitive data
                    usernameInput.value = '';
                    passwordInput.value = '';

                    showSuccess('Successfully retrieved Jellyfin credentials');

                } catch (error) {
                    showError(error.message);
                } finally {
                    loginButton.disabled = false;
                    loginButton.innerHTML = '<i class="fa-solid fa-key"></i> Get API Key & User ID';
                }
            });

            autoGroup.appendChild(createLabel('Username (for automatic setup)'));
            autoGroup.appendChild(usernameInput);
            autoGroup.appendChild(createLabel('Password (for automatic setup)'));
            autoGroup.appendChild(passwordInput);
            autoGroup.appendChild(loginButton);

            // Add all elements to wrapper
            wrapper.appendChild(manualGroup);
            wrapper.appendChild(separator);
            wrapper.appendChild(autoGroup);
        }

        container.appendChild(wrapper);
    }

    function createLabel(text) {
        const label = document.createElement('label');
        label.textContent = text;
        return label;
    }

    function renderPlexUserSelector(container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'user-selector-wrapper';

        // Check if controlled by ENV
        const isEnvControlled = Boolean(
            getNestedValue(currentOverrides, 'features.poster_users.plex')
        );

        if (isEnvControlled) {
            const overrideIndicator = document.createElement('div');
            overrideIndicator.className = 'env-override';
            overrideIndicator.textContent = 'Set by environment variable';
            wrapper.appendChild(overrideIndicator);
        } else {
            // Create manual input first
            const inputGroup = document.createElement('div');
            inputGroup.className = 'input-group';

            const manualInput = createInput(
                'text',
                getNestedValue(currentSettings, 'features.poster_users.plex'),
                false,
                (value) => handleSettingChange('features.poster_users.plex', value),
                'Comma-separated usernames'
            );
            inputGroup.appendChild(manualInput);

            // Add fetch button
            const fetchButton = document.createElement('button');
            fetchButton.className = 'discover-button';
            fetchButton.innerHTML = '<i class="fa-solid fa-users"></i> Fetch Users';

            fetchButton.addEventListener('click', async () => {
                try {
                    const plexUrl = getNestedValue(currentSettings, 'plex.url');
                    const plexToken = getNestedValue(currentSettings, 'plex.token');

                    if (!plexUrl || !plexToken) {
                        showError('Please configure Plex URL and token first');
                        return;
                    }

                    fetchButton.disabled = true;
                    fetchButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching...';

                    const response = await fetch('/api/plex/users', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            plex_url: plexUrl,
                            plex_token: plexToken
                        })
                    });

                    if (!response.ok) {
                        throw new Error('Failed to fetch users');
                    }

                    const data = await response.json();
                    showUserSelectionDialog(data.users, 'plex', manualInput);

                } catch (error) {
                    showError(error.message);
                } finally {
                    fetchButton.disabled = false;
                    fetchButton.innerHTML = '<i class="fa-solid fa-users"></i> Fetch Users';
                }
            });

            wrapper.appendChild(inputGroup);
            wrapper.appendChild(fetchButton);
        }

        container.appendChild(wrapper);
    }

    function renderJellyfinUserSelector(container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'user-selector-wrapper';

        // Check if controlled by ENV
        const isEnvControlled = Boolean(
            getNestedValue(currentOverrides, 'features.poster_users.jellyfin')
        );

        if (isEnvControlled) {
            const overrideIndicator = document.createElement('div');
            overrideIndicator.className = 'env-override';
            overrideIndicator.textContent = 'Set by environment variable';
            wrapper.appendChild(overrideIndicator);
        } else {
            // Create manual input first
            const inputGroup = document.createElement('div');
            inputGroup.className = 'input-group';

            const manualInput = createInput(
                'text',
                getNestedValue(currentSettings, 'features.poster_users.jellyfin'),
                false,
                (value) => handleSettingChange('features.poster_users.jellyfin', value),
                'Comma-separated usernames'
            );
            inputGroup.appendChild(manualInput);

            // Add fetch button
            const fetchButton = document.createElement('button');
            fetchButton.className = 'discover-button';
            fetchButton.innerHTML = '<i class="fa-solid fa-users"></i> Fetch Users';

            fetchButton.addEventListener('click', async () => {
                try {
                    const jellyfinUrl = getNestedValue(currentSettings, 'jellyfin.url');
                    const jellyfinApiKey = getNestedValue(currentSettings, 'jellyfin.api_key');

                    if (!jellyfinUrl || !jellyfinApiKey) {
                        showError('Please configure Jellyfin URL and API key first');
                        return;
                    }

                    fetchButton.disabled = true;
                    fetchButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching...';

                    const response = await fetch('/api/jellyfin/users', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            jellyfin_url: jellyfinUrl,
                            api_key: jellyfinApiKey
                        })
                    });

                    if (!response.ok) {
                        throw new Error('Failed to fetch users');
                    }

                    const data = await response.json();
                    showUserSelectionDialog(data.users, 'jellyfin', manualInput);

                } catch (error) {
                    showError(error.message);
                } finally {
                    fetchButton.disabled = false;
                    fetchButton.innerHTML = '<i class="fa-solid fa-users"></i> Fetch Users';
                }
            });

            wrapper.appendChild(inputGroup);
            wrapper.appendChild(fetchButton);
        }

        container.appendChild(wrapper);
    }

    function showUserSelectionDialog(users, service, inputElement) {
        const dialog = document.createElement('div');
        dialog.className = 'trakt-confirm-dialog';

        const currentUsers = inputElement.value.split(',').map(u => u.trim());

        dialog.innerHTML = `
            <div class="dialog-content">
                <h3><i class="fa-solid fa-users"></i> Select ${service.charAt(0).toUpperCase() + service.slice(1)} Users</h3>
                <div class="user-select">
                    ${users.map(user => `
                        <label class="user-option">
                            <input type="checkbox" value="${user}"
                                ${currentUsers.includes(user) ? 'checked' : ''}>
                            <span>${user}</span>
                        </label>
                    `).join('')}
                </div>
                <div class="dialog-buttons">
                    <button class="cancel-button">Cancel</button>
                    <button class="submit-button">Save Selection</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // Handle save
        dialog.querySelector('.submit-button').addEventListener('click', async () => {
            const selectedUsers = Array.from(dialog.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value);

            await handleSettingChange(`features.poster_users.${service}`, selectedUsers.join(','));
            inputElement.value = selectedUsers.join(',');
            dialog.remove();
        });

        // Handle cancel
        dialog.querySelector('.cancel-button').addEventListener('click', () => {
            dialog.remove();
        });
    }

    function renderTimezoneFieldWithButton(container) {
    	// Create wrapper
    	const wrapper = document.createElement('div');
    	wrapper.className = 'timezone-field-wrapper';

    	// Check if controlled by ENV
    	const isEnvControlled = Boolean(
            getNestedValue(currentOverrides, 'features.timezone')
    	);

    	if (isEnvControlled) {
            const overrideIndicator = document.createElement('div');
            overrideIndicator.className = 'env-override';
            overrideIndicator.textContent = 'Set by environment variable';
            wrapper.appendChild(overrideIndicator);
    	} else {
            // Create the text input field
            const inputGroup = document.createElement('div');
            inputGroup.className = 'input-group';

            const timezoneInput = createInput(
                'text',
                getNestedValue(currentSettings, 'features.timezone'),
                false,
                (value) => handleSettingChange('features.timezone', value),
                'Enter timezone (e.g., Europe/Berlin)'
            );

            inputGroup.appendChild(timezoneInput);

            // Create the "Search Timezone" button
            const searchButton = document.createElement('button');
            searchButton.className = 'discover-button';
            searchButton.innerHTML = '<i class="fa-solid fa-search"></i> Search Timezone';

            searchButton.addEventListener('click', () => {
            	showTimezoneSelectionDialog(timezoneInput);
            });

            wrapper.appendChild(inputGroup);
            wrapper.appendChild(searchButton);
        }

        container.appendChild(wrapper);
    }

    function showTimezoneSelectionDialog(inputElement) {
    	const dialog = document.createElement('div');
    	dialog.className = 'trakt-confirm-dialog'; // Reuse existing dialog style

    	// Get all timezones
    	const timezones = Intl.supportedValuesOf('timeZone');

    	// Create dialog content
    	dialog.innerHTML = `
            <div class="dialog-content">
                <h3><i class="fa-solid fa-globe"></i> Select Timezone</h3>
                <div class="timezone-dialog">
                    <input type="text" class="setting-input timezone-search" placeholder="Search timezones...">
                    <div class="timezone-list">
                        <!-- Timezone options will be inserted here -->
                    </div>
                </div>
                <div class="dialog-buttons">
                    <button class="cancel-button">Cancel</button>
                </div>
            </div>
        `;

    	document.body.appendChild(dialog);

    	const searchInput = dialog.querySelector('.timezone-search');
    	const timezoneList = dialog.querySelector('.timezone-list');

    	// Function to render timezone options
    	function renderTimezones(filter = '') {
            timezoneList.innerHTML = ''; // Clear existing options
            const filteredTimezones = timezones.filter(tz =>
            	tz.toLowerCase().includes(filter.toLowerCase())
            );

            const currentValue = inputElement.value;

            filteredTimezones.forEach(tz => {
            	const option = document.createElement('div');
            	option.className = 'timezone-option';
            	if (tz === currentValue) {
                    option.classList.add('selected');
            	}
            	option.textContent = tz;
            	option.addEventListener('click', () => {
                    inputElement.value = tz;
                    inputElement.dispatchEvent(new Event('input'));
                    handleSettingChange('features.timezone', tz);
                    dialog.remove();
            	});
                timezoneList.appendChild(option);
            });
        }

        // Initial render
        renderTimezones();

        // Event listener for search input
        searchInput.addEventListener('input', (e) => {
            renderTimezones(e.target.value);
    	});

    	// Handle cancel button
    	dialog.querySelector('.cancel-button').addEventListener('click', () => {
            dialog.remove();
        });
    }

    // Start initialization
    initialize();
});
