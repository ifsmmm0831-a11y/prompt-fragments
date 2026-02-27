/**
 * Prompt Fragments Extension for SillyTavern
 * Allows users to manage and toggle prompt fragments that combine with main prompts
 */

const MODULE_NAME = 'prompt_fragments';

// Get SillyTavern context
const {
    extensionSettings,
    saveSettingsDebounced,
    eventSource,
    event_types,
} = SillyTavern.getContext();

// Default settings structure
const defaultSettings = Object.freeze({
    enabled: true,
    categories: [], // Array of category objects
    collapsedCategories: {}, // Track which categories are collapsed
});

/**
 * Get or initialize extension settings
 */
function getSettings() {
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    
    // Ensure all default keys exist
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    
    return extensionSettings[MODULE_NAME];
}

/**
 * Generate unique ID for fragments and categories
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Save settings and update UI
 */
function saveSettings() {
    saveSettingsDebounced();
}

/**
 * Move array item
 */
function moveArrayItem(array, fromIndex, toIndex) {
    const item = array.splice(fromIndex, 1)[0];
    array.splice(toIndex, 0, item);
}

/**
 * Inject active fragments into prompt
 */
function injectFragments() {
    const settings = getSettings();
    
    if (!settings.enabled) {
        return;
    }
    
    // Get the context to access prompt manager
    const context = SillyTavern.getContext();
    
    if (!context.setExtensionPrompt) {
        console.warn('Prompt Fragments: setExtensionPrompt not available');
        return;
    }
    
    // Process each category
    for (const category of settings.categories) {
        // Skip if category is disabled
        if (category.enabled === false) {
            continue;
        }
        
        // Collect active fragments in this category
        const activeFragments = [];
        for (const fragment of category.fragments) {
            if (fragment.enabled && fragment.content) {
                activeFragments.push(fragment.content);
            }
        }
        
        // Skip if no active fragments
        if (activeFragments.length === 0) {
            continue;
        }
        
        // Combine fragments
        const combinedContent = activeFragments.join('\n\n');
        
        // Get category settings with defaults
        const positionMode = category.positionMode || 'relative'; // 'relative' or 'depth'
        const position = category.insertPosition || 'system'; // 'system', 'main', 'jailbreak'
        const role = category.role || 'system'; // 'system', 'user', 'assistant'
        const depth = category.depth || 0; // depth/priority
        
        // Create unique key for this category's prompt
        const promptKey = `${MODULE_NAME}_cat_${category.id}`;
        
        if (positionMode === 'relative') {
            // Relative mode: use position directly
            let positionNum = 1;
            if (position === 'main') positionNum = 2;
            else if (position === 'jailbreak') positionNum = 3;
            
            let roleNum = 0;
            if (role === 'user') roleNum = 1;
            else if (role === 'assistant') roleNum = 2;
            
            context.setExtensionPrompt(promptKey, combinedContent, positionNum, roleNum, 0);
        } else {
            // Depth mode: use depth value
            let roleNum = 0;
            if (role === 'user') roleNum = 1;
            else if (role === 'assistant') roleNum = 2;
            
            // In depth mode, always use system prompt position with custom depth
            context.setExtensionPrompt(promptKey, combinedContent, 1, roleNum, depth);
        }
    }
}

/**
 * Render the settings UI
 */
function renderSettingsUI() {
    const settings = getSettings();
    const container = $('#prompt_fragments_container');
    
    if (!container.length) {
        console.error('Prompt Fragments: Container not found');
        return;
    }
    
    container.empty();
    
    // Header with enable toggle and add category button (same row)
    const header = $('<div class="pf-header"></div>');
    
    const enableToggle = $(`
        <label class="checkbox_label pf-main-toggle">
            <input type="checkbox" id="pf_enable" ${settings.enabled ? 'checked' : ''} />
        </label>
    `);
    
    const addCategoryBtn = $('<button class="menu_button pf-add-category">+ 카테고리 추가</button>');
    
    header.append(enableToggle, addCategoryBtn);
    container.append(header);
    
    // Render categories
    const categoriesContainer = $('<div class="pf-categories"></div>');
    
    for (let i = 0; i < settings.categories.length; i++) {
        const category = settings.categories[i];
        const categoryEl = renderCategory(category, i);
        categoriesContainer.append(categoryEl);
    }
    
    container.append(categoriesContainer);
    
    // Event listeners
    $('#pf_enable').on('change', function() {
        settings.enabled = $(this).is(':checked');
        saveSettings();
    });
    
    addCategoryBtn.on('click', function() {
        const newCategory = {
            id: generateId(),
            name: '새 카테고리',
            enabled: true,
            positionMode: 'relative', // 'relative' or 'depth'
            insertPosition: 'system',
            role: 'system',
            depth: 0,
            fragments: []
        };
        settings.categories.push(newCategory);
        saveSettings();
        renderSettingsUI();
    });
}

/**
 * Render a single category
 */
function renderCategory(category, index) {
    const settings = getSettings();
    const isCollapsed = settings.collapsedCategories[category.id] || false;
    const positionMode = category.positionMode || 'relative';
    
    const categoryEl = $('<div class="pf-category"></div>');
    categoryEl.attr('data-category-id', category.id);
    categoryEl.attr('data-category-index', index);
    
    // Category header - single compact row
    const categoryHeader = $('<div class="pf-category-header"></div>');
    
    // Collapse button
    const collapseBtn = $(`
        <button class="pf-collapse-btn fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}"></button>
    `);
    
    // Category enable toggle
    const categoryToggle = $(`
        <label class="checkbox_label pf-category-toggle">
            <input type="checkbox" ${category.enabled !== false ? 'checked' : ''} />
        </label>
    `);
    
    const categoryTitle = $(`
        <input type="text" class="pf-category-name text_pole" value="${category.name}" placeholder="카테고리 이름" />
    `);
    
    // Button group
    const btnGroup = $('<div class="pf-btn-group"></div>');
    const moveUpBtn = $('<button class="menu_button pf-btn-small">↑</button>');
    const moveDownBtn = $('<button class="menu_button pf-btn-small">↓</button>');
    const deleteCategoryBtn = $('<button class="menu_button pf-btn-small pf-btn-danger">삭제</button>');
    
    btnGroup.append(moveUpBtn, moveDownBtn, deleteCategoryBtn);
    
    categoryHeader.append(collapseBtn, categoryToggle, categoryTitle, btnGroup);
    categoryEl.append(categoryHeader);
    
    // Category content (collapsible)
    const categoryContent = $('<div class="pf-category-content"></div>');
    if (isCollapsed) {
        categoryContent.hide();
    }
    
    // Settings row - compact single line
    const settingsRow = $('<div class="pf-settings-row"></div>');
    
    // Position mode selector
    const positionModeSelect = $(`
        <div class="pf-select-group">
            <label>위치:</label>
            <select class="pf-position-mode pf-select">
                <option value="relative" ${positionMode === 'relative' ? 'selected' : ''}>상대적인</option>
                <option value="depth" ${positionMode === 'depth' ? 'selected' : ''}>깊이에 따라</option>
            </select>
        </div>
    `);
    
    // Position selector (only visible in relative mode)
    const positionSelect = $(`
        <div class="pf-select-group pf-position-group" style="${positionMode === 'relative' ? '' : 'display:none;'}">
            <select class="pf-category-position pf-select">
                <option value="system" ${(category.insertPosition || 'system') === 'system' ? 'selected' : ''}>System</option>
                <option value="main" ${category.insertPosition === 'main' ? 'selected' : ''}>Main</option>
                <option value="jailbreak" ${category.insertPosition === 'jailbreak' ? 'selected' : ''}>Jailbreak</option>
            </select>
        </div>
    `);
    
    // Depth input (only visible in depth mode)
    const depthInput = $(`
        <div class="pf-select-group pf-depth-group" style="${positionMode === 'depth' ? '' : 'display:none;'}">
            <label>깊이:</label>
            <input type="number" class="pf-category-depth text_pole pf-select" value="${category.depth || 0}" min="0" max="999" />
        </div>
    `);
    
    // Role selector
    const roleSelect = $(`
        <div class="pf-select-group">
            <label>역할:</label>
            <select class="pf-category-role pf-select">
                <option value="system" ${(category.role || 'system') === 'system' ? 'selected' : ''}>System</option>
                <option value="user" ${category.role === 'user' ? 'selected' : ''}>User</option>
                <option value="assistant" ${category.role === 'assistant' ? 'selected' : ''}>Assistant</option>
            </select>
        </div>
    `);
    
    settingsRow.append(positionModeSelect, positionSelect, depthInput, roleSelect);
    categoryContent.append(settingsRow);
    
    // Add fragment button (right aligned)
    const fragmentBtnContainer = $('<div class="pf-fragment-btn-container"></div>');
    const addFragmentBtn = $('<button class="menu_button pf-add-fragment">+ 조각 추가</button>');
    fragmentBtnContainer.append(addFragmentBtn);
    categoryContent.append(fragmentBtnContainer);
    
    // Fragments container
    const fragmentsContainer = $('<div class="pf-fragments"></div>');
    
    for (let i = 0; i < category.fragments.length; i++) {
        const fragment = category.fragments[i];
        const fragmentEl = renderFragment(category.id, fragment, i);
        fragmentsContainer.append(fragmentEl);
    }
    
    categoryContent.append(fragmentsContainer);
    categoryEl.append(categoryContent);
    
    // Event listeners
    collapseBtn.on('click', function() {
        settings.collapsedCategories[category.id] = !isCollapsed;
        saveSettings();
        renderSettingsUI();
    });
    
    categoryToggle.find('input').on('change', function() {
        category.enabled = $(this).is(':checked');
        saveSettings();
    });
    
    categoryTitle.on('change', function() {
        category.name = $(this).val();
        saveSettings();
    });
    
    $('.pf-position-mode', settingsRow).on('change', function() {
        category.positionMode = $(this).val();
        saveSettings();
        renderSettingsUI(); // Re-render to show/hide depth or position
    });
    
    $('.pf-category-position', settingsRow).on('change', function() {
        category.insertPosition = $(this).val();
        saveSettings();
    });
    
    $('.pf-category-role', settingsRow).on('change', function() {
        category.role = $(this).val();
        saveSettings();
    });
    
    $('.pf-category-depth', settingsRow).on('change', function() {
        category.depth = parseInt($(this).val()) || 0;
        saveSettings();
    });
    
    moveUpBtn.on('click', function() {
        if (index > 0) {
            moveArrayItem(settings.categories, index, index - 1);
            saveSettings();
            renderSettingsUI();
        }
    });
    
    moveDownBtn.on('click', function() {
        if (index < settings.categories.length - 1) {
            moveArrayItem(settings.categories, index, index + 1);
            saveSettings();
            renderSettingsUI();
        }
    });
    
    deleteCategoryBtn.on('click', function() {
        if (confirm('이 카테고리를 삭제하시겠습니까?')) {
            settings.categories.splice(index, 1);
            delete settings.collapsedCategories[category.id];
            saveSettings();
            renderSettingsUI();
        }
    });
    
    addFragmentBtn.on('click', function() {
        const newFragment = {
            id: generateId(),
            title: '새 조각',
            content: '',
            enabled: false
        };
        category.fragments.push(newFragment);
        saveSettings();
        renderSettingsUI();
    });
    
    return categoryEl;
}

/**
 * Render a single fragment
 */
function renderFragment(categoryId, fragment, index) {
    const settings = getSettings();
    const category = settings.categories.find(c => c.id === categoryId);
    
    const fragmentEl = $('<div class="pf-fragment"></div>');
    fragmentEl.attr('data-fragment-id', fragment.id);
    fragmentEl.attr('data-fragment-index', index);
    
    // Fragment header - all in one compact row
    const fragmentHeader = $('<div class="pf-fragment-header"></div>');
    
    const toggle = $(`
        <label class="checkbox_label pf-fragment-toggle">
            <input type="checkbox" ${fragment.enabled ? 'checked' : ''} />
        </label>
    `);
    
    const title = $(`
        <input type="text" class="pf-fragment-title text_pole" value="${fragment.title}" placeholder="조각 제목" />
    `);
    
    // Compact button group
    const btnGroup = $('<div class="pf-btn-group"></div>');
    const moveUpBtn = $('<button class="menu_button pf-btn-small">↑</button>');
    const moveDownBtn = $('<button class="menu_button pf-btn-small">↓</button>');
    const editBtn = $('<button class="menu_button pf-btn-small pf-btn-edit">편집</button>');
    const deleteBtn = $('<button class="menu_button pf-btn-small pf-btn-danger">삭제</button>');
    
    btnGroup.append(moveUpBtn, moveDownBtn, editBtn, deleteBtn);
    
    fragmentHeader.append(toggle, title, btnGroup);
    
    // Content textarea (hidden by default)
    const contentArea = $(`
        <textarea class="pf-fragment-content text_pole" placeholder="프롬프트 내용을 입력하세요..." style="display: none;">${fragment.content || ''}</textarea>
    `);
    
    fragmentEl.append(fragmentHeader);
    fragmentEl.append(contentArea);
    
    // Event listeners
    toggle.find('input').on('change', function() {
        fragment.enabled = $(this).is(':checked');
        saveSettings();
    });
    
    title.on('change', function() {
        fragment.title = $(this).val();
        saveSettings();
    });
    
    moveUpBtn.on('click', function() {
        if (index > 0 && category) {
            moveArrayItem(category.fragments, index, index - 1);
            saveSettings();
            renderSettingsUI();
        }
    });
    
    moveDownBtn.on('click', function() {
        if (category && index < category.fragments.length - 1) {
            moveArrayItem(category.fragments, index, index + 1);
            saveSettings();
            renderSettingsUI();
        }
    });
    
    editBtn.on('click', function() {
        if (contentArea.is(':visible')) {
            contentArea.hide();
            editBtn.text('편집');
        } else {
            contentArea.show();
            editBtn.text('닫기');
        }
    });
    
    contentArea.on('change', function() {
        fragment.content = $(this).val();
        saveSettings();
    });
    
    deleteBtn.on('click', function() {
        if (!category) return;
        if (confirm('이 조각을 삭제하시겠습니까?')) {
            category.fragments.splice(index, 1);
            saveSettings();
            renderSettingsUI();
        }
    });
    
    return fragmentEl;
}

/**
 * Initialize the extension
 */
(function init() {
    console.log('Prompt Fragments: Initializing...');
    
    // Wait for app to be ready
    eventSource.on(event_types.APP_READY, () => {
        console.log('Prompt Fragments: App ready, setting up...');
        
        // Initialize settings
        getSettings();
        
        // Add settings panel to extensions
        const settingsHtml = `
            <div id="prompt_fragments_settings" class="extension-settings">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>Prompt Fragments (조각 프롬)</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <div id="prompt_fragments_container"></div>
                    </div>
                </div>
            </div>
        `;
        
        $('#extensions_settings2').append(settingsHtml);
        
        // Render initial UI
        renderSettingsUI();
    });
    
    // Hook into generation event to inject fragments
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => {
        injectFragments();
    });
    
    console.log('Prompt Fragments: Initialized');
})();
