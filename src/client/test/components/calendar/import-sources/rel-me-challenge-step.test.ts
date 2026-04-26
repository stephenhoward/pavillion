import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { ImportSource } from '@/common/model/import_source';
import { mountComponent } from '@/client/test/lib/vue';
import RelMeChallengeStep from '@/client/components/logged_in/calendar-management/import-sources/RelMeChallengeStep.vue';
import ImportSourceService from '@/client/service/import_source';
import {
  ImportSourceRelMeVerificationError,
  ImportSourceSsrfBlockedError,
  IMPORT_RELME_PAGE_FETCH_ERROR,
  IMPORT_RELME_PARSE_ERROR,
  IMPORT_RELME_LINK_NOT_FOUND,
  IMPORT_RELME_HOSTNAME_MISMATCH,
  IMPORT_RELME_PSL_VIOLATION,
} from '@/common/exceptions/import';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const CALENDAR_ID = 'cal-1';
const SOURCE_ID = 'src-1';
const SOURCE_URL = 'https://feeds.example.org/calendar.ics';
const INSTANCE_HOST = 'pavillion.test';
const CHALLENGE_TOKEN = 'abc123tokenXYZ';

const buildSource = (overrides: Partial<ImportSource> = {}): ImportSource => {
  const source = new ImportSource(SOURCE_ID, CALENDAR_ID, SOURCE_URL);
  source.verificationState = 'unverified';
  source.verificationType = 'rel-me';
  Object.assign(source, overrides);
  return source;
};

const mountStep = (propsOverride: Record<string, unknown> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const wrapper = mountComponent(RelMeChallengeStep, router, {
    props: {
      source: buildSource(),
      instanceHost: INSTANCE_HOST,
      challengeToken: CHALLENGE_TOKEN,
      ...propsOverride,
    },
  });

  return { wrapper };
};

describe('RelMeChallengeStep', () => {
  let issueChallengeMock: ReturnType<typeof vi.fn>;
  let verifySourceMock: ReturnType<typeof vi.fn>;
  let writeTextMock: ReturnType<typeof vi.fn>;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    issueChallengeMock = vi.fn().mockImplementation(async () => {
      callOrder.push('issueChallenge');
      return CHALLENGE_TOKEN;
    });
    verifySourceMock = vi.fn().mockImplementation(async () => {
      callOrder.push('verifySource');
      return buildSource({ verificationState: 'verified' });
    });

    vi.spyOn(ImportSourceService.prototype, 'issueChallenge').mockImplementation(issueChallengeMock);
    vi.spyOn(ImportSourceService.prototype, 'verifySource').mockImplementation(verifySourceMock);

    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      delete (globalThis.navigator as unknown as { clipboard?: unknown }).clipboard;
    }
    catch {
      // Some environments disallow delete on navigator; ignore.
    }
  });

  describe('rendering', () => {
    it('does not render a separate copy-link block for the verification URL', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      // The link-target row was removed in favor of the single HTML snippet
      // copy affordance — anyone capable of building a custom snippet from
      // the raw URL can edit the one we provide.
      expect(wrapper.find('[data-test="rel-me-link-target"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rel-me-copy-link"]').exists()).toBe(false);
    });

    it('renders the HTML snippet as text inside a <pre><code> block (no v-html)', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const snippetBlock = wrapper.find('[data-test="rel-me-html-snippet"]');
      expect(snippetBlock.exists()).toBe(true);
      // Element must be a <pre> > <code> structure rendered as plain text
      expect(snippetBlock.element.tagName.toLowerCase()).toBe('pre');
      expect(snippetBlock.find('code').exists()).toBe(true);
      // The angle brackets must appear as text characters, not as a parsed
      // <a> element. If v-html were used, the snippet would parse and a
      // real <a> would be present in the DOM.
      expect(snippetBlock.find('a').exists()).toBe(false);
      expect(snippetBlock.text()).toContain(
        `<a href="https://${INSTANCE_HOST}/.well-known/pavillion-verify/${CHALLENGE_TOKEN}" rel="me">`,
      );
    });

    it('renders the page URL input field as a text input (so schemeless input is not blocked by the browser)', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const input = wrapper.find('[data-test="rel-me-page-url-input"]');
      expect(input.exists()).toBe(true);
      // Native type="url" rejects schemeless input via HTML5 validation,
      // which is the UX trap we are explicitly avoiding. Use type="text"
      // with inputmode="url" to keep the mobile URL keyboard hint while
      // letting our validator handle scheme normalization.
      expect(input.attributes('type')).toBe('text');
      expect(input.attributes('inputmode')).toBe('url');
    });

    it('renders the verify button', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const verifyBtn = wrapper.find('[data-test="rel-me-verify-button"]');
      expect(verifyBtn.exists()).toBe(true);
    });
  });

  describe('verify button - call sequence', () => {
    it('calls issueChallenge BEFORE verifySource on click', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const input = wrapper.find('[data-test="rel-me-page-url-input"]');
      await input.setValue('https://feeds.example.org/about');

      const verifyBtn = wrapper.find('[data-test="rel-me-verify-button"]');
      await verifyBtn.trigger('click');
      await flushPromises();

      expect(issueChallengeMock).toHaveBeenCalledWith(
        CALENDAR_ID,
        SOURCE_ID,
        'rel-me',
      );
      expect(verifySourceMock).toHaveBeenCalledWith(
        CALENDAR_ID,
        SOURCE_ID,
        'https://feeds.example.org/about',
      );
      // Strictly enforce that issueChallenge ran before verifySource
      expect(callOrder).toEqual(['issueChallenge', 'verifySource']);
    });

    it('emits verified on successful verification', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue('https://feeds.example.org/about');
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      expect(wrapper.emitted('verified')).toBeTruthy();
      // Closing the wizard is the wizard shell's responsibility (mirrors
      // DnsChallengeStep). The step only signals that verification succeeded.
      expect(wrapper.emitted('close')).toBeFalsy();
    });
  });

  describe('error mapping', () => {
    const enterUrlAndClickVerify = async (wrapper: ReturnType<typeof mountStep>['wrapper']) => {
      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue('https://feeds.example.org/about');
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();
    };

    it('maps IMPORT_RELME_PAGE_FETCH_ERROR to errors.relme_page_fetch_error i18n key', async () => {
      verifySourceMock.mockImplementation(async () => {
        throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
      });

      const { wrapper } = mountStep();
      await flushPromises();
      await enterUrlAndClickVerify(wrapper);

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('Unable to fetch the verification page');
    });

    it('maps IMPORT_RELME_PARSE_ERROR to errors.relme_parse_error i18n key', async () => {
      verifySourceMock.mockImplementation(async () => {
        throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PARSE_ERROR);
      });

      const { wrapper } = mountStep();
      await flushPromises();
      await enterUrlAndClickVerify(wrapper);

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('could not be parsed as HTML');
    });

    it('maps IMPORT_RELME_LINK_NOT_FOUND to errors.relme_link_not_found i18n key', async () => {
      verifySourceMock.mockImplementation(async () => {
        throw new ImportSourceRelMeVerificationError(IMPORT_RELME_LINK_NOT_FOUND);
      });

      const { wrapper } = mountStep();
      await flushPromises();
      await enterUrlAndClickVerify(wrapper);

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('No matching rel="me" link');
    });

    it('maps IMPORT_RELME_HOSTNAME_MISMATCH to errors.relme_hostname_mismatch i18n key', async () => {
      verifySourceMock.mockImplementation(async () => {
        throw new ImportSourceRelMeVerificationError(IMPORT_RELME_HOSTNAME_MISMATCH);
      });

      const { wrapper } = mountStep();
      await flushPromises();
      await enterUrlAndClickVerify(wrapper);

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('same hostname');
    });

    it('maps IMPORT_RELME_PSL_VIOLATION to errors.relme_psl_violation i18n key', async () => {
      verifySourceMock.mockImplementation(async () => {
        throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PSL_VIOLATION);
      });

      const { wrapper } = mountStep();
      await flushPromises();
      await enterUrlAndClickVerify(wrapper);

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('not eligible for verification');
    });

    it('maps ImportSourceSsrfBlockedError to errors.ssrf_blocked i18n key', async () => {
      verifySourceMock.mockImplementation(async () => {
        throw new ImportSourceSsrfBlockedError();
      });

      const { wrapper } = mountStep();
      await flushPromises();
      await enterUrlAndClickVerify(wrapper);

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('not allowed');
    });

    it('does not echo the user-supplied URL in error messages', async () => {
      const userUrl = 'https://feeds.example.org/secret-page-name';
      verifySourceMock.mockImplementation(async () => {
        throw new ImportSourceRelMeVerificationError(IMPORT_RELME_LINK_NOT_FOUND);
      });

      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue(userUrl);
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).not.toContain('secret-page-name');
    });
  });

  describe('client-side URL validation', () => {
    it('shows a validation error when page URL is empty and does not call the API', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      // The error should be the field-level "required" message
      expect(alert.text().length).toBeGreaterThan(0);
      expect(issueChallengeMock).not.toHaveBeenCalled();
      expect(verifySourceMock).not.toHaveBeenCalled();
    });

    it('shows a validation error when scheme is not https and does not call the API', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue('http://feeds.example.org/about');
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(issueChallengeMock).not.toHaveBeenCalled();
      expect(verifySourceMock).not.toHaveBeenCalled();
    });

    it('accepts schemeless input and forwards a normalized https:// URL to verifySource', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      // The user types just the host + path. Requiring them to also type
      // `https://` is the UX trap this normalization fixes.
      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue('feeds.example.org/about');
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      expect(issueChallengeMock).toHaveBeenCalledTimes(1);
      expect(verifySourceMock).toHaveBeenCalledWith(
        CALENDAR_ID,
        SOURCE_ID,
        'https://feeds.example.org/about',
      );
    });

    it('accepts schemeless input on a bare hostname (no path)', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue('feeds.example.org');
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      expect(verifySourceMock).toHaveBeenCalledTimes(1);
      // URL normalization adds the trailing slash that the URL parser
      // produces from a bare-host input — verifying we send the parser's
      // canonical form rather than the user's literal text would lock us
      // in too tightly. We only assert the scheme + hostname are present.
      const sentUrl = verifySourceMock.mock.calls[0][2] as string;
      expect(sentUrl.startsWith('https://feeds.example.org')).toBe(true);
    });

    it('does NOT auto-prepend https:// when the user provided a non-https scheme (rejects with scheme error)', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      // Inputs that already declare a scheme are passed through so the
      // scheme check can produce a precise rejection. Without this the
      // user could paste `http://...` and the normalizer would silently
      // mask the scheme mismatch.
      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue('ftp://feeds.example.org/about');
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      expect(issueChallengeMock).not.toHaveBeenCalled();
      expect(verifySourceMock).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="rel-me-error"]').exists()).toBe(true);
    });

    it('shows a validation error when hostname does not match the source hostname', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue('https://other.example.com/about');
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(issueChallengeMock).not.toHaveBeenCalled();
      expect(verifySourceMock).not.toHaveBeenCalled();
    });

    it('shows a validation error when URL is over 2048 characters', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const longPath = 'a'.repeat(2050);
      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue(`https://feeds.example.org/${longPath}`);
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(issueChallengeMock).not.toHaveBeenCalled();
      expect(verifySourceMock).not.toHaveBeenCalled();
    });

    it('shows a validation error when URL cannot be parsed', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('[data-test="rel-me-page-url-input"]').setValue('not a url');
      await wrapper.find('[data-test="rel-me-verify-button"]').trigger('click');
      await flushPromises();

      const alert = wrapper.find('[data-test="rel-me-error"]');
      expect(alert.exists()).toBe(true);
      expect(issueChallengeMock).not.toHaveBeenCalled();
      expect(verifySourceMock).not.toHaveBeenCalled();
    });
  });

  describe('copy-to-clipboard', () => {
    it('copies the HTML snippet when the copy-html button is clicked', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const copyBtn = wrapper.find('[data-test="rel-me-copy-html"]');
      expect(copyBtn.exists()).toBe(true);
      await copyBtn.trigger('click');
      await flushPromises();

      // The link text inside the anchor is the source hostname, not the
      // instance host — it is a value the user already controls and gives
      // the snippet a meaningful display label on the verification page.
      const expectedSnippet = `<a href="https://${INSTANCE_HOST}/.well-known/pavillion-verify/${CHALLENGE_TOKEN}" rel="me">feeds.example.org</a>`;
      expect(writeTextMock).toHaveBeenCalledWith(expectedSnippet);
    });
  });
});
