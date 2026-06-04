export type Locale = "en" | "zh";

export interface Translations {
  common: {
    save: string;
    cancel: string;
    retry: string;
    search: string;
    coming: string;
    /** MobileListDetail back-bar label. */
    back: string;
  };

  /** Structured-memory (data sovereignty) panel. */
  memory: {
    explainer: string;
    unavailable: string;
    unavailableHint: string;
    empty: string;
    delete: string;
    confirmDelete: string;
    retrieved: string;
    trust: string;
  };

  /** Profile personality overlays tab. */
  personality: {
    explainer: string;
    empty: string;
    copyCommand: string;
    copied: string;
  };

  /** ⌘K command palette (search + navigate + actions). */
  palette: {
    placeholder: string;
    actions: string;
    pages: string;
    messages: string;
    newChat: string;
    toggleTheme: string;
    toggleReasoning: string;
    toggleTokens: string;
  };

  nav: {
    chat: string;
    sessions: string;
    agents: string;
    kanban: string;
    cron: string;
    skills: string;
    plugins: string;
    models: string;
    analytics: string;
    channels: string;
    logs: string;
    files: string;
    profile: string;
    settings: string;
    shortcuts: string;
    expandSidebar: string;
    collapseSidebar: string;
    // Mobile drawer/header strings — optional; components ship English fallbacks.
    openDrawer: string;
    closeDrawer: string;
    drawerLabel: string;
    newSession: string;
    newTask: string;
    logout: string;
    moduleAgent: string;
    moduleTasks: string;
    moduleManage: string;
    workspacesDrawer: string;
    exportSession: string;
    renameSession: string;
    clearSession: string;
    exportJson: string;
    exportMarkdown: string;
    exportPdf: string;
    copyId: string;
    copyIdDone: string;
    pin: string;
    unpin: string;
    archiveSession: string;
    deleteSession: string;
    clearLocal: string;
  };

  /** Primary CTAs surfaced in the Sidebar header etc. */
  actions: {
    newChat: string;
  };

  /** Sidebar-only strings. */
  sidebar: {
    recents: string;
    recentsEmpty: string;
    recentsError: string;
    viewAll: string;
    pinned: string;
  };

  /** UserButton popover labels (override `nav.*` defaults when set). */
  user: {
    localUser: string;
    profile: string;
    settings: string;
    shortcuts: string;
    signOut: string;
  };

  capability: {
    ready: string;
    degraded: string;
    fs: string;
    /** AIAgent importable. */
    hermes: string;
    dashboard: string;
    reachable: string;
    unreachable: string;
    reprobe: string;
    details: string;
    logout: string;
    gateAgentHeading: string;
    gateAgentDetail: string;
    gateDashboardHeading: string;
    gateDashboardDetail: string;
    gateAnyHeading: string;
    gateAnyDetail: string;
  };

  analytics: {
    gatewayStatus: string;
    dashboardStatus: string;
    activeSessions: string;
    todayTokens: string;
    recentSessions: string;
    manageInSettings: string;
    source: string;
    model: string;
    tokens: string;
    time: string;
    /** Capitalised; lowercase forms live under `capability`. */
    statusRunning: string;
    statusUnreachable: string;
  };

  /** Analytics charts i18n. */
  analyticsCharts: {
    range7d: string;
    range30d: string;
    range90d: string;
    tokenUsage: string;
    input: string;
    output: string;
    cache: string;
    costEstimate: string;
    estimated: string;
    actual: string;
    byModel: string;
    bySource: string;
    topSkills: string;
    dataNotReady: string;
    dashboardUnreachable: string;
  };

  connection: {
    stationSection: string;
    dashboardSection: string;
    gatewaySection: string;
    dashboardManagedByWs: string;
    gatewayManagedByLaunchd: string;
    gatewayManagedBySystemd: string;
    restartGateway: string;
    restartingGateway: string;
    restartGatewayHint: string;
    openInBrowser: string;
    pid: string;
    uptime: string;
    notInstalledHint: string;
    crashed: string;
    crashedHint: string;
    editFullConfigHint: string;
    openConfigTab: string;
    /** ConnectionDot tooltip when all systems are ok. */
    statusOk: string;
    /** ConnectionDot tooltip when caps.mode === "degraded" with no reason text. */
    statusDegraded: string;
  };

  logs: {
    title: string;
    follow: string;
    level: string;
    filter: string;
    files: {
      agent: string;
      errors: string;
      gateway: string;
    };
  };

  settings: {
    title: string;
    diagnostics: string;
    tabs: {
      preferences: string;
      appearance: string;
      security: string;
      system: string;
      advanced: string;
    };
    preferences: {
      displaySection: string;
      showReasoning: string;
      section: string;
      maxRuns: string;
      maxRunsHint: string;
      maxUpload: string;
      maxUploadHint: string;
      retention: string;
      retentionHint: string;
      saved: string;
      restartHint: string;
    };
    security: {
      networkSection: string;
      bindAddress: string;
      bindLocalhost: string;
      bindAllInterfaces: string;
      restartHint: string;
      authSection: string;
      passwordConfigured: string;
      passwordNotSet: string;
      newPassword: string;
      newPasswordHint: string;
      confirmPassword: string;
      setPassword: string;
      updatePassword: string;
      clearPassword: string;
      requirePassword: string;
      passwordMismatch: string;
      passwordTooShort: string;
      hardeningSection: string;
      csrfNote: string;
      rateLimitNote: string;
      argon2Note: string;
      sessionTtl: string;
      networkWarning: string;
    };
  };

  // chat.* dropped — every key (newSession/send/stop/placeholder/...) is
  // hard-coded English in the Composer/ChatStream/SessionRecents JSX.
  // Reintroduce only when those panels actually localise their copy.

  approval: {
    title: string;
    tool: string;
    command: string;
    riskLevel: string;
    deny: string;
    drawerTitle: string;
    approveOnce: string;
    approveSession: string;
    /** Approve permanently (writes config.yaml). */
    approveAlways: string;
    dismiss: string;
    alwaysHint: string;
    sessionHint: string;
    onceHint: string;
    freeformHint: string;
    noticeApprovedOnce: string;
    noticeApprovedSession: string;
    noticeApprovedAlways: string;
    noticeDenied: string;
  };

  shortcuts: {
    title: string;
    globalSearch: string;
    newSession: string;
    sendMessage: string;
    newLine: string;
    slashCommand: string;
    stopGeneration: string;
    closePanel: string;
    deleteSession: string;
  };

  setup: {
    hermesNotFound: string;
    hermesNotFoundDesc: string;
    installLink: string;
    degradedMode: string;
    degradedDesc: string;
    continueAnyway: string;
  };

  login: {
    title: string;
    subtitle: string;
    password: string;
    signIn: string;
    signingIn: string;
    invalidPassword: string;
    rateLimited: string;
  };

  /** Slash descriptions keyed by upstream command name; missing falls back to
   *  /api/discover/slash-commands.description (often empty). Never empty-shadows. */
  slash: {
    pluginSourceLabel: string;
    [key: string]: string;
  };

  theme: {
    sectionLabel: string;
    language: string;
    light: string;
    dark: string;
    system: string;
    toolCalls: string;
    toolCallsHint: string;
    product: string;
    productHint: string;
    technical: string;
    technicalHint: string;
  };
  skin: {
    sectionLabel: string;
    /** Per-skin label override; missing falls back to catalogue label in styles/skins.ts. */
    [key: string]: string | undefined;
  };
  fontSize: {
    sectionLabel: string;
    small: string;
    default: string;
    large: string;
    "extra-large": string;
  };

  files: {
    rootHermes: string;
    rootWorkspace: string;
    loading: string;
    loadingFile: string;
    empty: string;
    errorTree: string;
    pickAFile: string;
    save: string;
    saving: string;
    saved: string;
    rename: string;
    renamePrompt: string;
    delete: string;
    confirmDelete: string;
    download: string;
    refresh: string;
    bytes: string;
    binaryNote: string;
    binaryHint: string;
    showHidden: string;
    hideHidden: string;
    newFile: string;
    newFolder: string;
    filesTab: string;
    artifactsTab: string;
    noArtifacts: string;
    workspaceDefault: string;
    workspaceAdd: string;
    workspacePath: string;
    workspaceName: string;
    workspaceAlreadyExists: string;
    workspaceNotFound: string;
    workspaceSystemPath: string;
    historyTitle: string;
    historyEmpty: string;
    historyBy: string;
    historyViewAt: string;
    /** "More" action menu label (FileEditor [⋯] trigger). */
    more: string;
    /** Back-to-editor label when viewing version history. */
    backToFile: string;
    /** Chat workspace context panel → open the full /files page. */
    openFullPage: string;
    /** /files top bar → return to chat when deep-linked from the workspace. */
    backToChat: string;
  };

  agents: {
    subtitle: string;
    addAgent: string;
    noMembers: string;
    noMembersHint: string;
    respondsLabel: string;
    placeholder: string;
    remove: string;
    loading: string;
    errorLoading: string;
  };

  channels: {
    refresh: string;
    searchPlaceholder: string;
    platforms: string;
    keysHint: string;
    keysLink: string;
    builtin: string;
    plugin: string;
    running: string;
    stopped: string;
    broken: string;
    circuitOpen: string;
    statusUnknown: string;
    inflight: string;
    lastSeen: string;
    lastError: string;
    circuitHint: string;
    upstreamHint: string;
    loading: string;
    errorLoading: string;
    noPlatforms: string;
    noMatches: string;
  };

  kanban: {
    refresh: string;
    includeArchived: string;
    strandedBadge: string;
    strandedHint: string;
    loading: string;
    errorLoading: string;
    upstreamHint: string;
    empty: string;
    runningLocked: string;
    col_triage: string;
    col_todo: string;
    col_scheduled: string;
    col_ready: string;
    col_running: string;
    col_blocked: string;
    col_review: string;
    col_done: string;
    col_archived: string;
    board: string;
    newBoard: string;
    newBoardPrompt: string;
    nudge: string;
    tenant: string;
    assignee: string;
    allTenants: string;
    allAssignees: string;
    showArchived: string;
    clearFilters: string;
    searchPlaceholder: string;
    addCard: string;
    create: string;
  };

  composer: {
    /** ``{name}`` is the placeholder for the target profile name. */
    profileSwitchConfirm: string;
    manageProfiles: string;
    thinking: string;
    options: string;
    effort: string;
  };

  createProfile: {
    title: string;
    name: string;
    cloneFrom: string;
    cloneFromHint: string;
    none: string;
    model: string;
    provider: string;
    noSkills: string;
    create: string;
    creating: string;
    cancel: string;
    invalidName: string;
  };

  renameProfile: {
    title: string;
    newName: string;
    rename: string;
    renaming: string;
    cancel: string;
    invalidName: string;
  };

  profile: {
    refresh: string;
    newProfile: string;
    export: string;
    importProfile: string;
    listLabel: string;
    loading: string;
    errorLoading: string;
    noProfiles: string;
    selectAProfile: string;
    defaultBadge: string;
    distributionLabel: string;
    path: string;
    model: string;
    provider: string;
    skillCount: string;
    gateway: string;
    running: string;
    stopped: string;
    openTerminal: string;
    copyCmd: string;
    copied: string;
    rename: string;
    delete: string;
    confirmDelete: string;
    save: string;
    saving: string;
    saved: string;
    loadingSoul: string;
    name: string;
    newName: string;
    cloneFromDefault: string;
    noSkills: string;
    create: string;
    creating: string;
    cancel: string;
    renameDefaultWarning: string;
    startGateway: string;
    stopGateway: string;
  };

  plugins: {
    searchPlaceholder: string;
    refresh: string;
    enable: string;
    disable: string;
    uninstall: string;
    update: string;
    manageMemory: string;
    activeMemory: string;
    confirmUninstall: string;
    version: string;
    authRequired: string;
    authHint: string;
    loading: string;
    errorLoading: string;
    noPlugins: string;
    noMatches: string;
    groupMemory: string;
    groupActive: string;
    groupDisabled: string;
    selectPlugin: string;
    runtimeTitle: string;
    runtimeHint: string;
    memoryProvider: string;
    contextEngine: string;
    builtIn: string;
    save: string;
    saving: string;
    saved: string;
    gitTitle: string;
    gitHint: string;
    gitUrlLabel: string;
    forceReinstall: string;
    enableAfterInstall: string;
    installBtn: string;
    installing: string;
    installSuccess: string;
    installedTitle: string;
  };

  skills: {
    searchPlaceholder: string;
    refresh: string;
    install: string;
    installBtn: string;
    installing: string;
    installSuccess: string;
    identifierLabel: string;
    identifierHint: string;
    enableAfterInstall: string;
    forceReinstall: string;
    cancel: string;
    close: string;
    enable: string;
    disable: string;
    uninstall: string;
    confirmUninstall: string;
    bundledLock: string;
    selectASkill: string;
    loading: string;
    errorLoading: string;
    noSkills: string;
    noMatches: string;
    listLabel: string;
    toolsets: string;
    selected: string;
    clear: string;
    enabled: string;
    disabled: string;
    source: string;
    category: string;
    version: string;
    status: string;
    path: string;
    skillMdHint: string;
    loadingContent: string;
    allSources: string;
    sourceBundled: string;
    sourceUser: string;
    sourceCommunity: string;
    sourceHub: string;
    sourceHf: string;
    sourceGit: string;
  };

  /** MCP server management, shown on the /skills page. */
  mcp: {
    title: string;
    intro: string;
    add: string;
    addTitle: string;
    addConfirm: string;
    adding: string;
    cancel: string;
    remove: string;
    confirmRemove: string;
    enabled: string;
    disabled: string;
    toggleHint: string;
    empty: string;
    loading: string;
    error: string;
    alreadyExists: string;
    namePlaceholder: string;
    commandPlaceholder: string;
    argsPlaceholder: string;
    urlPlaceholder: string;
    oauth: string;
  };

  /** Cron panel strings. */
  cron: {
    searchPlaceholder: string;
    refresh: string;
    newJob: string;
    name: string;
    nameHint: string;
    schedule: string;
    schedHint: string;
    prompt: string;
    deliver: string;
    deliverLocal: string;
    deliverOrigin: string;
    state: string;
    lastRun: string;
    nextRun: string;
    actions: string;
    save: string;
    saving: string;
    cancel: string;
    close: string;
    pause: string;
    resume: string;
    trigger: string;
    delete: string;
    confirmDelete: string;
    paused: string;
    scheduled: string;
    errorState: string;
    completed: string;
    okStatus: string;
    errorStatus: string;
    repeatLabel: string;
    repeatRemaining: string;
    loading: string;
    errorLoading: string;
    noMatches: string;
    noJobs: string;
    selectAJob: string;
    infoBarActive: string;
    infoBarStopped: string;
    emptyNoJobs: string;
    createFromTemplate: string;
  };

  /** Models panel strings.
   *  Bracket-lookup keys like ``aux_vision`` and ``cat_provider`` are
   *  spelled out individually so TypeScript can validate the indices. */
  modelsPanel: {
    tabPrimary: string;
    tabAuxiliary: string;
    tabFallback: string;
    tabKeys: string;
    currentModel: string;
    default: string;
    providersLabel: string;
    refresh: string;
    test: string;
    testing: string;
    modelsCount: string;
    current: string;
    providerUnavailable: string;
    /**refresh of primary tab */
    change: string;
    pickPrimary: string;
    pickAux: string;
    searchPlaceholder: string;
    noResults: string;
    auto: string;
    autoLabel: string;
    autoHint: string;
    close: string;
    savedRestart: string;
    /** Auxiliary tab */
    auxiliaryHintV2: string;
    aux_vision: string;
    aux_web_extract: string;
    aux_compression: string;
    aux_session_search: string;
    aux_skills_hub: string;
    aux_approval: string;
    aux_mcp: string;
    aux_title_generation: string;
    aux_curator: string;
    /** Fallback tab */
    fallbackUnsupportedTitle: string;
    fallbackUnsupportedBody: string;
    /** Keys tab */
    keysHintV2: string;
    keysUnavailable: string;
    noKeys: string;
    reveal: string;
    hide: string;
    notSet: string;
    rateLimited: string;
    edit: string;
    delete: string;
    confirmDelete: string;
    editTitle: string;
    editValueLabel: string;
    editValuePlaceholder: string;
    editSave: string;
    editSaving: string;
    editCancel: string;
    editGetKeyAt: string;
    /** Category labels */
    cat_provider: string;
    cat_messaging: string;
    cat_tool: string;
    cat_skill: string;
    cat_setting: string;
    cat_other: string;
    /** Pareto router */
    paretoTitle: string;
    paretoDisabled: string;
    paretoDesc: string;
  };

  /** Config YAML editor strings. */
  config: {
    saved: string;
    upstreamUnreachable: string;
    reload: string;
    conflict: string;
    unsavedHint: string;
    idleHint: string;
    saving: string;
    save: string;
    discard: string;
    formView: string;
    yamlView: string;
    searchFields: string;
    needsDashboard: string;
    resetDefault: string;
    editInYaml: string;
  };
}
