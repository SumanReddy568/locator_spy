class DOMDiffer {
  constructor() {
    this.previousDOM = null;
    this.mutations = [];
    this.observer = null;
  }

  startTracking() {
    this.previousDOM = document.documentElement.cloneNode(true);
    this.mutations = [];
    this.observer = new MutationObserver((mutations) => {
      this.mutations.push(...mutations);
    });

    this.observer.observe(document.documentElement, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });

    console.log("DOMDiffer: Tracking started.");
  }

  stopTracking() {
    if (this.observer) {
      this.observer.disconnect();
      console.log("DOMDiffer: Tracking stopped.");
    }

    return this.getDOMChanges();
  }

  getDOMChanges() {
    const changes = {
      added: [],
      removed: [],
      modified: [],
      mutations: this.mutations,
    };

    if (!this.previousDOM) return changes;

    const currentDOM = document.documentElement;
    this._compareNodes(this.previousDOM, currentDOM, changes);

    return changes;
  }

  _compareNodes(oldNode, newNode, changes) {
    if (!oldNode || !newNode) return;

    if (oldNode.nodeType === Node.ELEMENT_NODE) {
      const oldAttrs = Array.from(oldNode.attributes || []);
      const newAttrs = Array.from(newNode.attributes || []);

      if (oldAttrs.length !== newAttrs.length) {
        changes.modified.push({ element: newNode, type: "attributes" });
      } else {
        for (let i = 0; i < oldAttrs.length; i++) {
          if (oldAttrs[i].value !== newAttrs[i].value) {
            changes.modified.push({ element: newNode, type: "attributes" });
            break;
          }
        }
      }
    }

    const oldChildren = Array.from(oldNode.childNodes);
    const newChildren = Array.from(newNode.childNodes);

    const maxLength = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLength; i++) {
      const oldChild = oldChildren[i];
      const newChild = newChildren[i];

      if (!oldChild && newChild) {
        changes.added.push(newChild);
      } else if (oldChild && !newChild) {
        changes.removed.push(oldChild);
      } else if (oldChild.nodeType === Node.ELEMENT_NODE && newChild.nodeType === Node.ELEMENT_NODE) {
        this._compareNodes(oldChild, newChild, changes);
      }
    }
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
    this.requests.clear();
    this.observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.entryType === "resource") {
          this.requests.set(entry.name, {
            url: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
            initiatorType: entry.initiatorType,
          });
        }
      });
    });

    this.observer.observe({ entryTypes: ["resource"] });
    console.log("NetworkRequestMapper: Tracking started.");
  }

  stopTracking() {
    if (this.observer) {
      this.observer.disconnect();
      console.log("NetworkRequestMapper: Tracking stopped.");
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