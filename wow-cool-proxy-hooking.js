// This code not being used now but I think I need to use it to implement global event hooking and such for more robust
// test execution smarts. TODO

// Define a handler object for the Proxy
const asyncOperationsHandler = {
  get: function(target, prop, receiver) {
    const original = target[prop];

    // Wrap specific async operations
    if (prop === 'setTimeout' || prop === 'setInterval') {
      return function(...args) {
        const callback = args[0];
        const wrappedCallback = function(...cbArgs) {
          callback(...cbArgs);
          // Add any additional completion logic here
          console.error('timeout or interval being run')
        };
        args[0] = wrappedCallback;
        console.error('timeout or interval being created')
        return original.apply(this, args);
      }
    } else if (prop === 'addEventListener') {
      return function(type, listener, options) {
        const wrappedListener = function(...args) {
          listener.apply(this, args);
          // Add any additional completion logic here
          console.error('aEL listener being called')
        }
        console.error('aEL being called')
        return original.call(this, type, wrappedListener, options);
      }
    } else if (prop === 'then' || prop === 'catch') {
      return function(callback) {
        const wrappedCallback = function(...args) {
          callback(...args);
          // Add any additional completion logic here
          console.error('Promise then/catch called')
        }
        return original.call(this, wrappedCallback);
      }
    }

    // For other properties, return the original value
    return original;
  }
};

// Create a Proxy for the global object (e.g., window or self)
const proxy = new Proxy(globalThis, asyncOperationsHandler);

// Use the proxy to access and wrap async operations
proxy.setTimeout(() => {
  console.log('Timeout called');
}, 1000);

const promise = new Promise((resolve) => {
  proxy.setTimeout(resolve, 2000);
});
promise.then(() => console.log('Promise resolved'));
