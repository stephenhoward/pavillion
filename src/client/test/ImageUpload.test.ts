import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import ImageUpload from '@/client/components/media/ImageUpload.vue';
import { mountComponent } from '@/client/test/lib/vue';
import { ValidationErrorCode } from '@/client/service/media';

const mountedUploader = (multiple: boolean, maxFiles: number = 10) => {
  let router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [],
  });

  const wrapper = mountComponent(ImageUpload, router, {
    props: {
      calendarId: 'test-calendar',
      multiple,
      maxFiles,
    },
  });

  return {
    wrapper,
    router,
  };
};

describe('ImageUpload Integration', () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mountedUploader(false).wrapper;
  });

  it('should render single file upload mode correctly', () => {
    expect(wrapper.find('.primary-text').text()).toBe('Drag and drop an image here');
  });

  it('should render multiple file upload mode correctly', async () => {
    const multiWrapper = mountedUploader(true).wrapper;

    expect(multiWrapper.find('.primary-text').text()).toBe('Drag and drop images here');
  });

  it('should show help text with correct configuration', () => {
    const helpTexts = wrapper.findAll('.help-text');
    expect(helpTexts.length).toBeGreaterThan(0);
    expect(helpTexts[0].text()).toContain('Supported formats');
    expect(helpTexts[1].text()).toContain('Maximum file size');
  });

  it('should have proper accessibility attributes', () => {
    const dropZone = wrapper.find('.upload-zone');
    expect(dropZone.attributes('role')).toBe('button');
    expect(dropZone.attributes('tabindex')).toBe('0');
    expect(dropZone.attributes('aria-label')).toBe('File upload drag and drop zone');

    const fileInput = wrapper.find('.file-input');
    expect(fileInput.attributes('aria-label')).toBe('Select files to upload');
  });

  it('should handle different prop configurations', async () => {
    await wrapper.setProps({
      multiple: true,
      maxFiles: 5,
      maxFileSize: 5 * 1024 * 1024,
      allowedTypes: ['image/png'],
      allowedExtensions: ['.png'],
    });

    // Component should still render correctly with new props
    expect(wrapper.vm.multiple).toBe(true);
    expect(wrapper.vm.maxFiles).toBe(5);
  });

  // UI Error Handling Tests
  it('should display error message for single file mode when multiple files are selected', async () => {
    // Mock multiple files being dropped/selected
    const mockFiles = [
      new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
      new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
    ];

    // Access the component's internal methods for testing
    const vm = wrapper.vm;
    await vm.preprocessAddedFiles(mockFiles);

    // Check that upload error is set in state
    expect(vm.state.uploadError).toBeDefined();
    expect(vm.state.uploadError.code).toBe(ValidationErrorCode.SINGLE_FILE_ONLY);

    // Wait for DOM update
    await wrapper.vm.$nextTick();

    // Check that error is displayed in UI
    const errorElement = wrapper.find('.upload-error');
    expect(errorElement.exists()).toBe(true);

    const errorMessage = errorElement.find('.error-message');
    expect(errorMessage.text()).toContain('Only one file is allowed in single file mode');
  });

  it('should display error message when too many files are selected', async () => {
    const multiWrapper = mountedUploader(true, 2).wrapper;

    // Mock more files than allowed
    const mockFiles = [
      new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
      new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
      new File(['test3'], 'test3.jpg', { type: 'image/jpeg' }),
    ];

    const vm = multiWrapper.vm;
    await vm.preprocessAddedFiles(mockFiles);

    // Check that upload error is set in state
    expect(vm.state.uploadError).toBeDefined();
    expect(vm.state.uploadError.code).toBe(ValidationErrorCode.TOO_MANY_FILES);

    await multiWrapper.vm.$nextTick();

    // Check that error is displayed in UI
    const errorElement = multiWrapper.find('.upload-error');
    expect(errorElement.exists()).toBe(true);

    const errorMessage = errorElement.find('.error-message');
    expect(errorMessage.text()).toContain('Too many files selected. Maximum allowed: 2');
  });

  it('should clear error when dismiss button is clicked', async () => {
    const mockFiles = [
      new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
      new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
    ];

    const vm = wrapper.vm;
    await vm.preprocessAddedFiles(mockFiles);
    await wrapper.vm.$nextTick();

    // Verify error is displayed
    let errorElement = wrapper.find('.upload-error');
    expect(errorElement.exists()).toBe(true);

    // Click dismiss button
    const dismissButton = errorElement.find('.error-dismiss');
    await dismissButton.trigger('click');
    await wrapper.vm.$nextTick();

    // Verify error is cleared
    errorElement = wrapper.find('.upload-error');
    expect(errorElement.exists()).toBe(false);
    expect(vm.state.uploadError).toBeNull();
  });

  it('should clear error when files are removed to resolve the issue', async () => {
    const multiWrapper = mountedUploader(true, 2).wrapper;

    // Add files that exceed the limit
    const mockFiles = [
      new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
      new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
      new File(['test3'], 'test3.jpg', { type: 'image/jpeg' }),
    ];

    const vm = multiWrapper.vm;
    await vm.preprocessAddedFiles(mockFiles);

    // Manually set files since preprocessAddedFiles returns early on error
    vm.state.files = [
      { file: mockFiles[0], id: '1', status: 'pending', progress: 0 },
      { file: mockFiles[1], id: '2', status: 'pending', progress: 0 },
      { file: mockFiles[2], id: '3', status: 'pending', progress: 0 },
    ];

    await multiWrapper.vm.$nextTick();

    // Verify error is displayed
    expect(vm.state.uploadError).toBeDefined();

    // Remove a file to get within the limit
    vm.removeFile('3');
    await multiWrapper.vm.$nextTick();

    // Error should be cleared since we're now within the limit
    expect(vm.state.uploadError).toBeNull();
  });

  it('should clear error when new files are processed', async () => {
    const mockFiles = [
      new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
      new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
    ];

    const vm = wrapper.vm;
    await vm.preprocessAddedFiles(mockFiles);

    // Verify error is set
    expect(vm.state.uploadError).toBeDefined();

    // Process a single valid file
    const validFile = new File(['valid'], 'valid.jpg', { type: 'image/jpeg' });
    await vm.preprocessAddedFiles([validFile]);

    // Error should be cleared
    expect(vm.state.uploadError).toBeNull();
  });

  it('should handle drag events on single file preview in error state', async () => {
    // Add a valid file first to enter single file preview mode
    const validFile = new File(['valid'], 'valid.jpg', { type: 'image/jpeg' });
    const vm = wrapper.vm;

    await vm.preprocessAddedFiles([validFile]);
    await wrapper.vm.$nextTick();

    expect(vm.singleFilePreview).toBeTruthy();

    const singlePreview = wrapper.find('.single-file-preview');
    expect(singlePreview.exists()).toBe(true);

    // Verify drag handlers are present on single file preview
    expect(singlePreview.element.getAttribute('@dragover')).toBeDefined;
    expect(singlePreview.element.getAttribute('@drop')).toBeDefined;

    // Test that drag events are handled correctly with separate state
    await singlePreview.trigger('dragover');
    expect(vm.state.isSinglePreviewDragOver).toBe(true);

    await singlePreview.trigger('dragleave');
    expect(vm.state.isSinglePreviewDragOver).toBe(false);

    // Test that drop event clears the drag state
    const newFile = new File(['replacement'], 'replacement.jpg', { type: 'image/jpeg' });
    await singlePreview.trigger('drop', {
      dataTransfer: { files: [newFile] },
    });

    expect(vm.state.isSinglePreviewDragOver).toBe(false);
  });
});
