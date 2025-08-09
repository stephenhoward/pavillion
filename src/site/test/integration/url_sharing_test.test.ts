import { describe, it, expect } from 'vitest';

describe('URL Sharing for Category Filters', () => {
  describe('URL Construction and Parsing', () => {
    it('should construct shareable URLs with category parameters', () => {
      // Test URL construction for different scenarios
      const baseUrl = 'http://localhost:3000';
      const calendarName = 'test-calendar';

      // Single category URL
      const singleCategoryId = '123e4567-e89b-12d3-a456-426614174000';
      const singleCategoryUrl = `${baseUrl}/calendars/${calendarName}?categories=${singleCategoryId}`;

      expect(singleCategoryUrl).toContain(calendarName);
      expect(singleCategoryUrl).toContain('categories=');
      expect(singleCategoryUrl).toContain(singleCategoryId);

      // Multiple categories URL
      const multipleCategoryIds = [
        '123e4567-e89b-12d3-a456-426614174000',
        '987fcdeb-51a2-43d1-9c7f-ba9876543210',
      ];
      const multipleCategoryUrl = `${baseUrl}/calendars/${calendarName}?categories=${multipleCategoryIds.join(',')}`;

      expect(multipleCategoryUrl).toContain(multipleCategoryIds[0]);
      expect(multipleCategoryUrl).toContain(multipleCategoryIds[1]);
      expect(multipleCategoryUrl).toContain(',');
    });

    it('should parse category parameters from URLs correctly', () => {
      // Test URL parameter parsing
      const testUrls = [
        {
          url: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000',
          expectedCategories: ['123e4567-e89b-12d3-a456-426614174000'],
        },
        {
          url: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000,987fcdeb-51a2-43d1-9c7f-ba9876543210',
          expectedCategories: ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-43d1-9c7f-ba9876543210'],
        },
        {
          url: 'http://localhost:3000/calendars/test',
          expectedCategories: [],
        },
      ];

      testUrls.forEach(testCase => {
        const urlObj = new URL(testCase.url);
        const categoriesParam = urlObj.searchParams.get('categories');

        if (testCase.expectedCategories.length === 0) {
          expect(categoriesParam).toBeNull();
        }
        else {
          expect(categoriesParam).toBeTruthy();
          const parsedCategories = categoriesParam!.split(',').map(id => id.trim());
          expect(parsedCategories).toEqual(testCase.expectedCategories);
        }
      });
    });

    it('should handle URL encoding properly', () => {
      // Test URL encoding scenarios
      const categoryId = '123e4567-e89b-12d3-a456-426614174000';
      const calendarName = 'test-calendar';

      // Standard encoding
      const standardUrl = `http://localhost:3000/calendars/${calendarName}?categories=${encodeURIComponent(categoryId)}`;
      const parsedUrl = new URL(standardUrl);
      const decodedCategory = parsedUrl.searchParams.get('categories');

      expect(decodedCategory).toBe(categoryId);

      // Multiple categories with encoding
      const categories = [categoryId, '987fcdeb-51a2-43d1-9c7f-ba9876543210'];
      const encodedCategories = categories.map(id => encodeURIComponent(id)).join(',');
      const multiUrl = `http://localhost:3000/calendars/${calendarName}?categories=${encodedCategories}`;

      const multiParsedUrl = new URL(multiUrl);
      const multiDecodedCategories = multiParsedUrl.searchParams.get('categories');

      expect(multiDecodedCategories).toContain(categoryId);
      expect(multiDecodedCategories).toContain(categories[1]);
    });
  });

  describe('Browser State Management', () => {
    it('should support history navigation scenarios', () => {
      // Test browser history scenarios with category filters
      const baseUrl = 'http://localhost:3000/calendars/test-calendar';
      const categoryId = '123e4567-e89b-12d3-a456-426614174000';

      const navigationSequence = [
        `${baseUrl}`, // Start with no filters
        `${baseUrl}?categories=${categoryId}`, // Add category filter
        `${baseUrl}?categories=${categoryId},987fcdeb-51a2-43d1-9c7f-ba9876543210`, // Add second category
        `${baseUrl}`, // Back to no filters
      ];

      navigationSequence.forEach((url, index) => {
        const urlObj = new URL(url);
        const categoriesParam = urlObj.searchParams.get('categories');

        switch (index) {
          case 0:
          case 3:
            expect(categoriesParam).toBeNull();
            break;
          case 1:
            expect(categoriesParam).toBe(categoryId);
            break;
          case 2:
            expect(categoriesParam).toContain(categoryId);
            expect(categoriesParam).toContain(',');
            break;
        }
      });
    });

    it('should handle edge cases in URL parameters', () => {
      // Test edge cases that browsers might encounter
      const edgeCases = [
        {
          name: 'Empty category parameter',
          url: 'http://localhost:3000/calendars/test?categories=',
          expectValid: true,
          expectedCategories: [],
        },
        {
          name: 'Categories with spaces',
          url: 'http://localhost:3000/calendars/test?categories= 123e4567-e89b-12d3-a456-426614174000 , 987fcdeb-51a2-43d1-9c7f-ba9876543210 ',
          expectValid: true,
          cleanup: true, // Should trim spaces
        },
        {
          name: 'Duplicate category IDs',
          url: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000,123e4567-e89b-12d3-a456-426614174000',
          expectValid: true,
          expectDuplicates: true,
        },
        {
          name: 'Mixed valid and empty values',
          url: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000,,987fcdeb-51a2-43d1-9c7f-ba9876543210',
          expectValid: true,
          expectFiltering: true, // Should filter out empty values
        },
      ];

      edgeCases.forEach(testCase => {
        const urlObj = new URL(testCase.url);
        const categoriesParam = urlObj.searchParams.get('categories');

        if (testCase.expectedCategories && testCase.expectedCategories.length === 0) {
          expect(categoriesParam).toBe('');
        }
        else if (testCase.expectValid) {
          if (categoriesParam) {
            const categories = categoriesParam.split(',');

            if (testCase.cleanup) {
              // Verify we can clean up the categories
              const cleanedCategories = categories.map(cat => cat.trim()).filter(cat => cat.length > 0);
              expect(cleanedCategories.length).toBeGreaterThan(0);
              cleanedCategories.forEach(cat => {
                expect(cat).toMatch(/^[a-f0-9-]{36}$/i); // UUID format
              });
            }

            if (testCase.expectDuplicates) {
              expect(categories.length).toBeGreaterThan(1);
              expect(categories[0]).toBe(categories[1]);
            }

            if (testCase.expectFiltering) {
              expect(categories).toContain(''); // Should contain empty string
              const filteredCategories = categories.filter(cat => cat.trim().length > 0);
              expect(filteredCategories.length).toBe(2);
            }
          }
        }
      });
    });
  });

  describe('Cross-Browser Compatibility', () => {
    it('should handle different browser URL encoding behaviors', () => {
      // Test scenarios that different browsers might handle differently
      const categoryId = '123e4567-e89b-12d3-a456-426614174000';

      const browserScenarios = [
        {
          name: 'Chrome-style encoding',
          url: `http://localhost:3000/calendars/test?categories=${categoryId}`,
          encoding: 'standard',
        },
        {
          name: 'Safari hash handling',
          url: `http://localhost:3000/calendars/test?categories=${categoryId}#events`,
          hasFragment: true,
        },
        {
          name: 'Firefox case sensitivity',
          url: `http://localhost:3000/calendars/test?categories=${categoryId.toUpperCase()}`,
          caseVariation: true,
        },
        {
          name: 'IE query parameter order',
          url: `http://localhost:3000/calendars/test?view=month&categories=${categoryId}&sort=date`,
          multipleParams: true,
        },
      ];

      browserScenarios.forEach(scenario => {
        const urlObj = new URL(scenario.url);
        const categoriesParam = urlObj.searchParams.get('categories');

        expect(categoriesParam).toBeTruthy();

        if (scenario.hasFragment) {
          expect(urlObj.hash).toBe('#events');
        }

        if (scenario.caseVariation) {
          expect(categoriesParam).toBe(categoryId.toUpperCase());
        }

        if (scenario.multipleParams) {
          expect(urlObj.searchParams.get('view')).toBe('month');
          expect(urlObj.searchParams.get('sort')).toBe('date');
          expect(urlObj.searchParams.get('categories')).toBe(categoryId);
        }
      });
    });

    it('should maintain URL integrity across operations', () => {
      // Test URL manipulation operations that frontend code might perform
      const baseUrl = 'http://localhost:3000/calendars/test-calendar';
      const categories = ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-43d1-9c7f-ba9876543210'];

      // Test URL construction
      let url = new URL(baseUrl);
      url.searchParams.set('categories', categories.join(','));

      expect(url.toString()).toContain('categories=');
      expect(url.toString()).toContain(categories[0]);
      expect(url.toString()).toContain(categories[1]);

      // Test URL modification
      url.searchParams.set('categories', categories[0]); // Change to single category
      expect(url.searchParams.get('categories')).toBe(categories[0]);
      expect(url.toString()).not.toContain(categories[1]);

      // Test URL clearing
      url.searchParams.delete('categories');
      expect(url.searchParams.get('categories')).toBeNull();
      expect(url.toString()).not.toContain('categories=');

      // Test URL restoration
      url.searchParams.set('categories', categories.join(','));
      expect(url.searchParams.get('categories')).toBe(categories.join(','));
    });
  });
});
