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

// Position modes
// 단일 드롭다운으로 6가지 위치 제공
// SillyTavern setExtensionPrompt(key, value, position, depth, scan, role)
//   position: 0=IN_PROMPT(스토리스트링 끝), 1=IN_CHAT(depth 기반), 2=BEFORE_PROMPT(메인 앞), 3=NONE
//   depth   : 0=최신 메시지 뒤, 숫자 ↑ = 더 과거로
//   role    : 0=system, 1=user, 2=assistant
//
// 월드인포는 보통 world_info_depth(기본 4) 위치에 들어감.
// 따라서 WI 앞 = depth 5, WI 뒤 = depth 3 으로 근사.
const POSITION_PRESETS = {
    before_main:  { label: '메인 프롬프트 앞',   position: 2, depth: 0 },
    after_main:   { label: '메인 프롬프트 뒤',   position: 0, depth: 0 },
    before_wi:    { label: '월드인포 앞',         position: 1, depth: 5 },
    after_wi:     { label: '월드인포 뒤',         position: 1, depth: 3 },
    before_chat:  { label: '챗 히스토리 앞',     position: 1, depth: 999 },
    after_chat:   { label: '챗 히스토리 뒤',     position: 1, depth: 0 },
};

const POSITION_NONE = 3; // extension_prompt_types.NONE — 비활성 상태로 등록

// Default settings structure
const defaultSettings = Object.freeze({
    enabled: true,
    categories: [], // Array of category objects
    collapsedCategories: {}, // Track which categories are collapsed
});

// 매 주입마다 어떤 key 들을 등록했는지 추적 → 다음 주입 때 청소용
let lastRegisteredKeys = new Set();

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

    // Migration: 옛 positionMode/insertPosition/depth 를 새 positionKey 로 흡수
    for (const cat of extensionSettings[MODULE_NAME].categories) {
        if (!cat.positionKey) {
            // 기본값: 메인 뒤 (가장 일반적)
            cat.positionKey = 'after_main';
            // 옛 'depth' 모드였으면 챗 히스토리 뒤로 대충 매핑
            if (cat.positionMode === 'depth') {
                cat.positionKey = 'after_chat';
            }
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
 * Role string → number
 */
function roleToNum(role) {
    if (role === 'user') return 1;
    if (role === 'assistant') return 2;
    return 0; // system
}

/**
 * 모든 카테고리 prompt key 를 빈 값(NONE) 으로 비움.
 * 이게 핵심 — OFF 토글 시 잔존 프롬프트 제거.
 */
function clearAllFragmentPrompts() {
    const context = SillyTavern.getContext();
    if (!context.setExtensionPrompt) return;

    for (const key of lastRegisteredKeys) {
        // value='' + position=NONE 으로 등록해서 사실상 죽임
        context.setExtensionPrompt(key, '', POSITION_NONE, 0, false, 0);
    }
    lastRegisteredKeys.clear();
}

/**
 * Inject active fragments into prompt
 */
function injectFragments() {
    const settings = getSettings();
    const context = SillyTavern.getContext();

    if (!context.setExtensionPrompt) {
        console.warn('Prompt Fragments: setExtensionPrompt not available');
        return;
    }

    // 1. 매번 이전 등록을 전부 청소.
    //    이게 없으면 OFF 후에도 SillyTavern 내부 캐시에 prompt 가 남아 계속 들어감.
    clearAllFragmentPrompts();

    // 2. 확장 자체가 꺼져있으면 여기서 끝. (이미 위에서 다 비웠음)
    if (!settings.enabled) {
        return;
    }

    // 3. 살아있는 카테고리만 다시 등록
    for (const category of settings.categories) {
        if (category.enabled === false) continue;

        // 활성 조각만 모으기
        const activeFragments = [];
        for (const fragment of category.fragments) {
            if (fragment.enabled && fragment.content) {
                activeFragments.push(fragment.content);
            }
        }
        if (activeFragments.length === 0) continue;

        const combinedContent = activeFragments.join('\n\n');

        // 위치 프리셋 적용
        const preset = POSITION_PRESETS[category.positionKey] || POSITION_PRESETS.after_main;
        const role = roleToNum(category.role || 'system');

        const promptKey = `${MODULE_NAME}_cat_${category.id}`;

        // setExtensionPrompt(key, value, position, depth, scan, role)
        context.setExtensionPrompt(
            promptKey,
            combinedContent,
            preset.position,
            preset.depth,
            false,
            role,
        );

        lastRegisteredKeys.add(promptKey);
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
        // 토글 즉시 반영을 위해 청소.
        // 다음 생성 시 injectFragments 가 다시 채움.
        if (!settings.enabled) {
            clearAllFragmentPrompts();
        }
    });

    addCategoryBtn.on('click', function() {
        const newCategory = {
            id: generateId(),
            name: '새 카테고리',
            enabled: true,
            positionKey: 'after_main',
            role: 'system',
            fragments: []
        };
        settings.categories.push(newCategory);
        saveSettings();
        renderSettingsUI();
    });
}

/**
 * Build position dropdown options HTML
 */
function buildPositionOptions(selectedKey) {
    return Object.entries(POSITION_PRESETS)
        .map(([key, preset]) => {
            const sel = key === selectedKey ? 'selected' : '';
            return `<option value="${key}" ${sel}>${preset.label}</option>`;
        })
        .join('');
}

/**
 * Render a single category
 */
function renderCategory(category, index) {
    const settings = getSettings();
    const isCollapsed = settings.collapsedCategories[category.id] || false;

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

    // 단일 위치 드롭다운
    const positionSelect = $(`
        <div class="pf-select-group">
            <label>위치:</label>
            <select class="pf-category-position pf-select" title="월드인포 위치는 SillyTavern의 World Info Depth 설정을 기준으로 합니다.">
                ${buildPositionOptions(category.positionKey || 'after_main')}
            </select>
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

    settingsRow.append(positionSelect, roleSelect);
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
        // 카테고리 OFF 즉시 반영 — 해당 key 비우기
        if (category.enabled === false) {
            const context = SillyTavern.getContext();
            if (context.setExtensionPrompt) {
                const promptKey = `${MODULE_NAME}_cat_${category.id}`;
                context.setExtensionPrompt(promptKey, '', POSITION_NONE, 0, false, 0);
                lastRegisteredKeys.delete(promptKey);
            }
        }
    });

    categoryTitle.on('change', function() {
        category.name = $(this).val();
        saveSettings();
    });

    $('.pf-category-position', settingsRow).on('change', function() {
        category.positionKey = $(this).val();
        saveSettings();
    });

    $('.pf-category-role', settingsRow).on('change', function() {
        category.role = $(this).val();
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
            // 삭제 전에 해당 prompt key 비우기 — 안 그러면 좀비로 남음
            const context = SillyTavern.getContext();
            if (context.setExtensionPrompt) {
                const promptKey = `${MODULE_NAME}_cat_${category.id}`;
                context.setExtensionPrompt(promptKey, '', POSITION_NONE, 0, false, 0);
                lastRegisteredKeys.delete(promptKey);
            }
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
        // 조각 OFF → 카테고리 안의 다른 조각이 남아있을 수 있으니
        // 단순히 key 를 비우면 안 됨. 대신 다음 generation 때 injectFragments 가
        // 재조합하면서 자연스럽게 빠짐. 하지만 "이미 등록된" prompt 는 그대로 남으니
        // 안전하게 즉시 재주입.
        injectFragments();
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
            // 삭제 후 즉시 재주입 — 좀비 prompt 방지
            injectFragments();
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
