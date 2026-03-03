import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import ImageUpload from '@/client/components/common/media/ImageUpload.vue';
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
    expect(wrapper.find('.upload-text .primary').text()).toBe('Drag and drop an image here');
  });

  it('should render multiple file upload mode correctly', async () => {
    const multiWrapper = mountedUploader(true).wrapper;

    expect(multiWrapper.find('.upload-text .primary').text()).toBe('Drag and drop images here');
  });

  it('should show format hints with correct configuration', () => {
    const formatHint = wrapper.find('.format-hint');
    expect(formatHint.exists()).toBe(true);
    expect(formatHint.text()).toContain('.jpg');
    expect(formatHint.text()).toContain('Maximum file size');
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
    });

    // Component should still render correctly with new props
    expect(wrapper.vm.props.multiple).toBe(true);
    expect(wrapper.vm.props.maxFiles).toBe(5);
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
    const errorElement = wrapper.find('.validation-error');
    expect(errorElement.exists()).toBe(true);
    expect(errorElement.text()).toContain('Only one file is allowed in single file mode');
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
    const errorElement = multiWrapper.find('.validation-error');
    expect(errorElement.exists()).toBe(true);
    expect(errorElement.text()).toContain('Too many files selected. Maximum allowed: 2');
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
    let errorElement = wrapper.find('.validation-error');
    expect(errorElement.exists()).toBe(true);

    // Click dismiss button
    const dismissButton = errorElement.find('.dismiss');
    await dismissButton.trigger('click');
    await wrapper.vm.$nextTick();

    // Verify error is cleared
    errorElement = wrapper.find('.validation-error');
    expect(errorElement.exists()).toBe(false);
    expect(vm.state.uploadError).toBeNull();
  });

  it('should clear error when new valid file is processed', async () => {
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

  it('should show preview state when file is added', async () => {
    const validFile = new File(['valid'], 'valid.jpg', { type: 'image/jpeg' });
    const vm = wrapper.vm;

    await vm.preprocessAddedFiles([validFile]);
    await wrapper.vm.$nextTick();

    // Check that we have a file in state
    expect(vm.hasFiles).toBe(true);
    expect(vm.currentFile).toBeTruthy();

    // Check preview state is rendered
    const previewState = wrapper.find('.preview-state');
    expect(previewState.exists()).toBe(true);
  });

  it('should clear file when clear button is clicked', async () => {
    const validFile = new File(['valid'], 'valid.jpg', { type: 'image/jpeg' });
    const vm = wrapper.vm;

    await vm.preprocessAddedFiles([validFile]);
    await wrapper.vm.$nextTick();

    expect(vm.hasFiles).toBe(true);

    // Call clearFile method
    vm.clearFile();
    await wrapper.vm.$nextTick();

    expect(vm.hasFiles).toBe(false);
    expect(vm.state.files.length).toBe(0);
  });

  it('should handle drag over state on upload zone', async () => {
    const vm = wrapper.vm;
    const dropZone = wrapper.find('.upload-zone');

    // Trigger dragover
    await dropZone.trigger('dragover');
    expect(vm.state.isDragOver).toBe(true);

    // Trigger dragleave
    await dropZone.trigger('dragleave');
    expect(vm.state.isDragOver).toBe(false);
  });
});
