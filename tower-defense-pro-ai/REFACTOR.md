// In your React component where you handle canvas clicks,
// add touch support alongside mouse:

canvas.addEventListener("touchstart", (e) => {
e.preventDefault();
const touch = e.touches[0];
const rect = canvas.getBoundingClientRect();
const scaleX = canvas.width / rect.width;
const scaleY = canvas.height / rect.height;
const x = (touch.clientX - rect.left) _ scaleX;
const y = (touch.clientY - rect.top) _ scaleY;

// same logic as your mousedown handler
handleCanvasClick(x, y);
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
e.preventDefault();
const touch = e.touches[0];
const rect = canvas.getBoundingClientRect();
const scaleX = canvas.width / rect.width;
const scaleY = canvas.height / rect.height;
const x = (touch.clientX - rect.left) _ scaleX;
const y = (touch.clientY - rect.top) _ scaleY;

// same logic as your mousemove handler
handleCanvasHover(x, y);
}, { passive: false });
