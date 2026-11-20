const fs = require('fs');
const path = require('path');
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');

const DEFAULT_ANDROID_PACKAGE = 'com.debtfree.nativetest';

function buildPullDownViewManagerKotlin(packageName) {
  return `package ${packageName}

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.uimanager.events.NativeGestureUtil
import com.facebook.react.views.view.ReactViewGroup
import kotlin.math.abs
import kotlin.math.max

private class PullMoveEvent(
  surfaceId: Int,
  viewTag: Int,
  private val dy: Float,
) : Event<PullMoveEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topPullMove"

  override fun getEventData(): WritableMap =
    Arguments.createMap().apply {
      putDouble("dy", dy.toDouble())
    }
}

private class PullReleaseEvent(
  surfaceId: Int,
  viewTag: Int,
  private val dy: Float,
  private val cancelled: Boolean,
) : Event<PullReleaseEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = "topPullRelease"

  override fun getEventData(): WritableMap =
    Arguments.createMap().apply {
      putDouble("dy", dy.toDouble())
      putBoolean("cancelled", cancelled)
    }
}

class DFNPullDownView(context: Context) : ReactViewGroup(context) {
  var pullEnabled: Boolean = true
  var refreshing: Boolean = false

  private val interceptTouchSlop: Float =
    max(10f, ViewConfiguration.get(context).scaledTouchSlop * 0.85f)
  private var startX: Float = 0f
  private var startY: Float = 0f
  private var pullStartY: Float = 0f
  private var activePointerId: Int = MotionEvent.INVALID_POINTER_ID
  private var isPulling: Boolean = false

  private fun canAnyChildScrollUp(viewGroup: ViewGroup): Boolean {
    for (i in 0 until viewGroup.childCount) {
      val child: View = viewGroup.getChildAt(i) ?: continue
      if (child.visibility != View.VISIBLE) continue
      if (child.canScrollVertically(-1)) return true
      if (child is ViewGroup && canAnyChildScrollUp(child)) return true
    }
    return false
  }

  private fun dispatchPullMove(dyDp: Float) {
    val reactContext = context as? ThemedReactContext ?: return
    val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id) ?: return
    dispatcher.dispatchEvent(PullMoveEvent(UIManagerHelper.getSurfaceId(this), id, dyDp))
  }

  private fun dispatchPullRelease(dyDp: Float, cancelled: Boolean) {
    val reactContext = context as? ThemedReactContext ?: return
    val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id) ?: return
    dispatcher.dispatchEvent(PullReleaseEvent(UIManagerHelper.getSurfaceId(this), id, dyDp, cancelled))
  }

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    if (!pullEnabled || refreshing) {
      if (isPulling) {
        isPulling = false
      }
      return super.onInterceptTouchEvent(event)
    }

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        activePointerId = event.getPointerId(0)
        startX = event.x
        startY = event.y
        pullStartY = event.y
        isPulling = false
      }
      MotionEvent.ACTION_MOVE -> {
        if (!isPulling && activePointerId != MotionEvent.INVALID_POINTER_ID) {
          val pointerIndex = event.findPointerIndex(activePointerId)
          if (pointerIndex >= 0) {
            val dx = event.getX(pointerIndex) - startX
            val dy = event.getY(pointerIndex) - startY
            if (dy > interceptTouchSlop && dy > abs(dx) * 1.3f && !canAnyChildScrollUp(this)) {
              isPulling = true
              pullStartY = startY + interceptTouchSlop * 0.4f
              NativeGestureUtil.notifyNativeGestureStarted(this, event)
              parent?.requestDisallowInterceptTouchEvent(true)
              val initialDy = max(0f, event.getY(pointerIndex) - pullStartY)
              dispatchPullMove(PixelUtil.toDIPFromPixel(initialDy))
              return true
            }
          }
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        activePointerId = MotionEvent.INVALID_POINTER_ID
        isPulling = false
      }
    }

    return super.onInterceptTouchEvent(event)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!isPulling) {
      return super.onTouchEvent(event)
    }

    when (event.actionMasked) {
      MotionEvent.ACTION_MOVE -> {
        val pointerIndex = event.findPointerIndex(activePointerId)
        if (pointerIndex >= 0) {
          val rawDy = max(0f, event.getY(pointerIndex) - pullStartY)
          dispatchPullMove(PixelUtil.toDIPFromPixel(rawDy))
        }
        return true
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        val cancelled = event.actionMasked == MotionEvent.ACTION_CANCEL
        val pointerIndex = event.findPointerIndex(activePointerId)
        val rawDy = if (!cancelled && pointerIndex >= 0) {
          max(0f, event.getY(pointerIndex) - pullStartY)
        } else {
          0f
        }
        isPulling = false
        activePointerId = MotionEvent.INVALID_POINTER_ID
        NativeGestureUtil.notifyNativeGestureEnded(this, event)
        dispatchPullRelease(PixelUtil.toDIPFromPixel(rawDy), cancelled)
        return true
      }
    }

    return true
  }
}

class DFNPullDownViewManager : ViewGroupManager<DFNPullDownView>() {
  override fun getName(): String = "DFNPullDownView"

  override fun createViewInstance(reactContext: ThemedReactContext): DFNPullDownView =
    DFNPullDownView(reactContext)

  @ReactProp(name = "pullEnabled", defaultBoolean = true)
  fun setPullEnabled(view: DFNPullDownView, enabled: Boolean) {
    view.pullEnabled = enabled
  }

  @ReactProp(name = "refreshing", defaultBoolean = false)
  fun setRefreshing(view: DFNPullDownView, refreshing: Boolean) {
    view.refreshing = refreshing
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> {
    val base = super.getExportedCustomDirectEventTypeConstants()
    val constants: MutableMap<String, Any> = base ?: HashMap()
    constants["topPullMove"] = mutableMapOf("registrationName" to "onPullMove")
    constants["topPullRelease"] = mutableMapOf("registrationName" to "onPullRelease")
    return constants
  }
}

class DFNSwipeBlockView(context: Context) : ReactViewGroup(context) {
  private val touchSlop: Float = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
  private var downX: Float = 0f
  private var downY: Float = 0f
  private var horizontalLocked: Boolean = false

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = ev.rawX
        downY = ev.rawY
        horizontalLocked = false
        parent?.requestDisallowInterceptTouchEvent(true)
      }
      MotionEvent.ACTION_MOVE -> {
        if (!horizontalLocked) {
          val dx = abs(ev.rawX - downX)
          val dy = abs(ev.rawY - downY)
          if (dx > touchSlop * 0.4f && dx >= dy) {
            horizontalLocked = true
            parent?.requestDisallowInterceptTouchEvent(true)
          } else if (dy > touchSlop * 1.5f && dy > dx * 1.6f) {
            parent?.requestDisallowInterceptTouchEvent(false)
          }
        } else {
          parent?.requestDisallowInterceptTouchEvent(true)
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        horizontalLocked = false
        parent?.requestDisallowInterceptTouchEvent(false)
      }
    }
    return super.dispatchTouchEvent(ev)
  }
}

class DFNSwipeBlockViewManager : ViewGroupManager<DFNSwipeBlockView>() {
  override fun getName(): String = "DFNSwipeBlockView"

  override fun createViewInstance(reactContext: ThemedReactContext): DFNSwipeBlockView =
    DFNSwipeBlockView(reactContext)
}
`;
}

function buildPullDownPackageKotlin(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DFNPullDownPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    emptyList()

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(DFNPullDownViewManager(), DFNSwipeBlockViewManager())
}
`;
}

function ensureMainApplicationRegistration(contents) {
  if (contents.includes('DFNPullDownPackage()')) return contents;
  const marker = 'PackageList(this).packages.apply {';
  const idx = contents.indexOf(marker);
  if (idx === -1) {
    throw new Error('Unable to locate PackageList(this).packages.apply block in MainApplication.kt.');
  }
  const insertPos = idx + marker.length;
  return `${contents.slice(0, insertPos)}\n          add(DFNPullDownPackage())${contents.slice(insertPos)}`;
}

function withAndroidPullDownView(config) {
  const packageName = config.android?.package || DEFAULT_ANDROID_PACKAGE;
  const packageSegments = packageName.split('.');

  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const targetDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...packageSegments,
      );
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(
        path.join(targetDir, 'DFNPullDownViewManager.kt'),
        buildPullDownViewManagerKotlin(packageName),
        'utf8',
      );
      fs.writeFileSync(
        path.join(targetDir, 'DFNPullDownPackage.kt'),
        buildPullDownPackageKotlin(packageName),
        'utf8',
      );
      return modConfig;
    },
  ]);

  config = withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents = ensureMainApplicationRegistration(modConfig.modResults.contents);
    return modConfig;
  });

  return config;
}

withAndroidPullDownView.ensureMainApplicationRegistration = ensureMainApplicationRegistration;
withAndroidPullDownView.buildPullDownViewManagerKotlin = buildPullDownViewManagerKotlin;
module.exports = withAndroidPullDownView;
