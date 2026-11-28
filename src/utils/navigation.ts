import type { ContentCategory, ViewRoute } from '../types/vyora';
import { CATEGORY_LIST } from '../i18n/translations';

export interface ParsedLocationRoute {
  route: ViewRoute;
  contentId: string;
  creatorId: string | null;
  category: ContentCategory | 'All';
}

const VALID_ROUTES = new Set<ViewRoute>([
  'home',
  'explore',
  'categories',
  'search',
  'pricing',
  'detail',
  'creator',
  'login',
  'signup',
  'viewer-dashboard',
  'creator-dashboard',
  'admin-dashboard',
  'guide',
  'about',
  'contact',
  'terms',
  'privacy',
  'guidelines',
]);

export function parseLocationRoute(search = typeof window !== 'undefined' ? window.location.search : ''): ParsedLocationRoute {
  const params = new URLSearchParams(search);
  const videoId = params.get('v')?.trim() || '';
  const creatorParam = params.get('creator')?.trim() || '';
  const catParam = params.get('cat')?.trim() || '';
  const pageParam = params.get('page')?.trim() || '';

  const category: ContentCategory | 'All' = CATEGORY_LIST.includes(
    catParam as ContentCategory
  )
    ? (catParam as ContentCategory)
    : 'All';

  if (videoId) {
    return {
      route: 'detail',
      contentId: videoId,
      creatorId: creatorParam || null,
      category,
    };
  }

  if (creatorParam && (!pageParam || pageParam === 'creator')) {
    return {
      route: 'creator',
      contentId: '',
      creatorId: creatorParam,
      category,
    };
  }

  const route: ViewRoute = VALID_ROUTES.has(pageParam as ViewRoute)
    ? (pageParam as ViewRoute)
    : 'home';

  return {
    route,
    contentId: '',
    creatorId: creatorParam || null,
    category,
  };
}

export function buildRouteUrl(state: {
  route: ViewRoute;
  contentId?: string;
  creatorId?: string | null;
  category?: ContentCategory | 'All';
}): string {
  const params = new URLSearchParams();

  if (state.route === 'detail' && state.contentId) {
    params.set('v', state.contentId);
  } else if (state.route === 'creator' && state.creatorId) {
    params.set('creator', state.creatorId);
  } else if (state.route !== 'home') {
    params.set('page', state.route);
    if (state.route === 'explore') {
      if (state.category && state.category !== 'All') {
        params.set('cat', state.category);
      }
      if (state.creatorId) {
        params.set('creator', state.creatorId);
      }
    }
  }

  const query = params.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

export function buildAbsoluteShareUrl(state: {
  route: ViewRoute;
  contentId?: string;
  creatorId?: string | null;
}): string {
  if (typeof window === 'undefined') return '';
  const relative = buildRouteUrl(state);
  return `${window.location.origin}${relative}`;
}
