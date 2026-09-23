// Moved to src/common/ui/composables/useLocalizedContent.ts, the shared UI
// module. This shim keeps the existing
// '@/site/composables/useLocalizedContent' call sites working; new call sites
// should import the shared path directly.
export * from '@/common/ui/composables/useLocalizedContent';
