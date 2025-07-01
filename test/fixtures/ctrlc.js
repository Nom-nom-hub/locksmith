// This script is used to verify that requiring locksmith does not interfere with Ctrl-C (SIGINT)
require('../../');

console.log('Process started. Press Ctrl-C to exit.');
setInterval(() => {}, 1000); // Keep the process alive
