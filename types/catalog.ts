export type CatalogMovieSummary = {
  id: string;
  slug: string;
  title: string;
  synopsis: string;
  posterUrl: string | null;
  releaseLabel: string | null;
  isActive: boolean;
  sortOrder: number;
  mediaAssetId: string | null;
  mediaAssetTitle: string | null;
  audioTrackCount: number;
  subtitleTrackCount: number;
  languageAvailabilityLabel: string | null;
};

export type CatalogMovieDetail = CatalogMovieSummary & {
  originalFilename: string | null;
};

export type AdminMediaAssetOption = {
  id: string;
  title: string;
  originalFilename: string;
  createdAt: string;
  audioTrackCount: number;
  subtitleTrackCount: number;
};

export type AdminCatalogDashboard = {
  movies: CatalogMovieSummary[];
  mediaAssets: AdminMediaAssetOption[];
  activeMovieCount: number;
};
