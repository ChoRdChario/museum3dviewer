export const i18n = {
  lang: 'ja',
  t(k){ return (this[this.lang] && this[this.lang][k]) || (this.en[k]||k); },
  ja: {
    search: '検索', list:'一覧', read:'読書', add:'追加',
  },
  en: {
    search: 'Search', list:'List', read:'Read', add:'Add',
  }
};
