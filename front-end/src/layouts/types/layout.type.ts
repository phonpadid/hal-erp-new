export type MenuMode = "static" | "overlay" | "horizontal" | "slim" | "drawer";
export interface LayoutConfig {
  preset: string;
  primary: string;
  surface: string | null;
  darkTheme: boolean;
  menuMode: MenuMode;
}
export interface LayoutState {
  staticMenuInactive: boolean;
  overlayMenuActive: boolean;
  profileSidebarVisible: boolean;
  configSidebarVisible: boolean;
  sidebarExpanded: boolean;
  menuHoverActive: boolean;
  activeMenuItem: string | null;
  activePath: string | null;
  mobileMenuActive: boolean;
  anchored: boolean;
}