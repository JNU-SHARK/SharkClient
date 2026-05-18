/// <reference types="vite/client" />

type UnlistenFn = () => void;

interface NamedContentFile {
  filename: string;
  name?: string;
  content: string;
}

interface DashboardPanelUsage {
  filename: string;
  name: string;
}

interface DashboardPanelUsageResult {
  success: boolean;
  usedBy: DashboardPanelUsage[];
}

interface CommandResult {
  success: boolean;
  error?: string;
}

interface DashboardConfigListResult extends CommandResult {
  configs: Array<{ filename: string; name: string; modifiedAt: string }>;
}

interface DashboardConfigLoadResult extends CommandResult {
  content?: string;
}

type GraphicTemplateCategories = {
  basic: NamedContentFile[];
  dynamic: NamedContentFile[];
  fix: NamedContentFile[];
};

interface SharkClientApi {
  [key: string]: any;
  onMaximizedStateChanged?: (cb: (state: boolean) => void) => UnlistenFn;
  onMatchStatusChanged?: (cb: (status: import('@/components/Dashboard/types').MatchStatus) => void) => UnlistenFn;
  isDevToolsOpened?: () => Promise<boolean>;
  openDevTools?: () => Promise<void>;
  closeDevTools?: () => Promise<void>;
  hud?: {
    getTemplates: () => Promise<NamedContentFile[]>;
    saveTemplate: (filename: string, content: string) => Promise<void>;
    updateTemplateTitle: (id: string, title: string) => Promise<void>;
    deleteTemplate: (id: string) => Promise<void>;
    onTemplateChanged?: (cb: (event: { eventType: string; filename: string }) => void) => UnlistenFn;
  };
  graphic?: {
    getAllCategories: () => Promise<GraphicTemplateCategories>;
    getList: () => Promise<NamedContentFile[]>;
    save: (filename: string, content: string) => Promise<void>;
    delete: (filename: string) => Promise<void>;
    rename: (oldName: string, newName: string) => Promise<void>;
  };
  dashboardConfig?: {
    list: () => Promise<DashboardConfigListResult>;
    load: (filename: string) => Promise<DashboardConfigLoadResult>;
    save: (filename: string, content: string) => Promise<CommandResult>;
    delete: (filename: string) => Promise<CommandResult>;
    checkPanelUsage: (panelId: string) => Promise<DashboardPanelUsageResult>;
  };
}

declare global {
  interface Window {
    api: SharkClientApi;
  }
}
export {};
