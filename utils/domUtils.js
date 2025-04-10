class DOMDiffer {
  constructor() {
    this.previousDOM = null;
    this.mutations = [];
    this.observer = null;
  }

  startTracking() {
    // Use requestAnimationFrame for smoother DOM updates
    requestAnimationFrame(() => {
      this.previousDOM = document.documentElement.cloneNode(false); // Shallow clone for better performance
      this.observer = new MutationObserver(mutations => {
        // Batch mutations instead of concatenating
        if (mutations.length > 0) {
          this.mutations = mutations;
        }
      });
      
      this.observer.observe(document.documentElement, {
        childList: true,
        attributes: true,
        characterData: true,
        subtree: true,
        attributeFilter: ['class', 'style', 'id'] 
      });
    });
  }

  stopTracking() {
    if (this.observer) {
      this.observer.disconnect();
      const changes = this.getDOMChanges();
      this.mutations = [];
      this.previousDOM = null;
      return changes;
    }
    return { added: [], removed: [], modified: [], mutations: [] };
  }

  getDOMChanges() {
    const changes = {
      added: [],
      removed: [],
      modified: [],
      mutations: this.mutations
    };

    if (!this.previousDOM) return changes;

    const currentDOM = document.documentElement;
    this._compareNodes(this.previousDOM, currentDOM, changes);

    return changes;
  }

  _compareNodes(oldNode, newNode, changes) {
    if (!oldNode || !newNode) return;

    if (oldNode.nodeType === Node.ELEMENT_NODE) {
      // Optimize attribute comparison
      const relevantAttrs = ['class', 'style', 'id'];
      const hasChanged = relevantAttrs.some(attr => 
        oldNode.getAttribute(attr) !== newNode.getAttribute(attr)
      );
      
      if (hasChanged) {
        changes.modified.push({
          element: newNode,
          type: 'attributes'
        });
      }
    }

    // Optimize children comparison using DocumentFragment
    const fragment = document.createDocumentFragment();
    const newChildren = Array.from(newNode.children);
    const oldChildren = Array.from(oldNode.children);

    newChildren.forEach((child, index) => {
      const oldChild = oldChildren[index];
      if (!oldChild) {
        fragment.appendChild(child.cloneNode(true));
        changes.added.push(child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        this._compareNodes(oldChild, child, changes);
      }
    });

    oldChildren.slice(newChildren.length).forEach(child => {
      changes.removed.push(child);
    });
  }
}

class PerformanceTracker {
  constructor() {
    this.metrics = new Map();
  }

  startMeasure(locatorType, locatorValue) {
    const key = `${locatorType}:${locatorValue}`;
    this.metrics.set(key, {
      start: performance.now(),
      type: locatorType,
      value: locatorValue
    });
  }

  endMeasure(locatorType, locatorValue) {
    const key = `${locatorType}:${locatorValue}`;
    const metric = this.metrics.get(key);
    if (metric) {
      metric.end = performance.now();
      metric.duration = metric.end - metric.start;
      return metric;
    }
    return null;
  }

  getMetrics() {
    return Array.from(this.metrics.values());
  }
}

class NetworkRequestMapper {
  constructor() {
    this.requests = new Map();
    this.observer = null;
  }

  startTracking() {
    this.observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.entryType === 'resource') {
          this.requests.set(entry.name, {
            url: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
            initiatorType: entry.initiatorType
          });
        }
      });
    });

    this.observer.observe({ entryTypes: ['resource'] });
  }

  stopTracking() {
    if (this.observer) {
      this.observer.disconnect();
    }
    return Array.from(this.requests.values());
  }

  mapRequestsToElement(element) {
    const timestamp = performance.now();
    return Array.from(this.requests.values()).filter(request => {
      return request.startTime <= timestamp && 
             request.startTime >= (timestamp - 5000); // Look back 5 seconds
    });
  }
}

export const domDiffer = new DOMDiffer();
export const performanceTracker = new PerformanceTracker();
export const networkMapper = new NetworkRequestMapper();