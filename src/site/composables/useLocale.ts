// Moved to src/common/ui/composables/useLocale.ts, the shared UI module. This
// shim keeps the existing '@/site/composables/useLocale' call sites (and the
// component tests that mock that specifier) working; new call sites should
// import the shared path directly.
export * from '@/common/ui/composables/useLocale';
