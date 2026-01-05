import { ref, onMounted, onUnmounted, type Ref } from 'vue';

export interface SwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  minDistance?: number; // Minimum swipe distance in pixels
  maxVerticalDistance?: number; // Maximum vertical deviation for horizontal swipe
}

/**
 * Composable for detecting horizontal swipe gestures on mobile devices
 *
 * @param elementRef - Reference to the element to detect swipes on
 * @param options - Configuration for swipe detection and callbacks
 * @returns Object with touch event handlers
 */
export function useSwipeGesture(
  elementRef: Ref<HTMLElement | null>,
  options: SwipeGestureOptions = {},
) {
  const {
    onSwipeLeft,
    onSwipeRight,
    minDistance = 50, // Default 50px minimum swipe distance
    maxVerticalDistance = 75, // Maximum 75px vertical deviation
  } = options;

  const touchStartX = ref(0);
  const touchStartY = ref(0);
  const touchStartTime = ref(0);

  const handleTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    touchStartX.value = touch.clientX;
    touchStartY.value = touch.clientY;
    touchStartTime.value = Date.now();
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX.value;
    const deltaY = Math.abs(touch.clientY - touchStartY.value);
    const deltaTime = Date.now() - touchStartTime.value;

    // Ignore if vertical movement is too large (likely scrolling)
    if (deltaY > maxVerticalDistance) {
      return;
    }

    // Ignore if swipe is too short
    if (Math.abs(deltaX) < minDistance) {
      return;
    }

    // Calculate velocity (pixels per millisecond)
    const velocity = Math.abs(deltaX) / deltaTime;

    // Require minimum velocity to distinguish from slow dragging
    if (velocity < 0.2) {
      return;
    }

    // Determine swipe direction
    if (deltaX < 0 && onSwipeLeft) {
      // Swiped left (next)
      onSwipeLeft();
    }
    else if (deltaX > 0 && onSwipeRight) {
      // Swiped right (previous)
      onSwipeRight();
    }
  };

  const attachListeners = () => {
    const element = elementRef.value;
    if (element) {
      element.addEventListener('touchstart', handleTouchStart, { passive: true });
      element.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
  };

  const removeListeners = () => {
    const element = elementRef.value;
    if (element) {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchend', handleTouchEnd);
    }
  };

  onMounted(() => {
    attachListeners();
  });

  onUnmounted(() => {
    removeListeners();
  });

  return {
    handleTouchStart,
    handleTouchEnd,
  };
}
