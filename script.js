/**
 * PixelatedTextEffect
 *
 * This class creates a pixelated, interactive text effect using WebGL and Three.js.
 * It renders a text texture onto a plane and applies a custom shader to produce a pixelated
 * and ripple distortion effect based on mouse movement.
 *
 * The effect responds to mouse events to create a dynamic visual interaction:
 * - Moving the mouse distorts the text pixels in the direction of movement.
 * - Entering and leaving the container adjusts the easing of the effect.
 *
 * Key flow:
 * 1. Generate a high-resolution canvas texture with the desired text.
 * 2. Set up a Three.js scene with an orthographic camera and a shader material.
 * 3. Use a fragment shader to pixelate the text and apply a ripple effect based on mouse input.
 * 4. Animate the scene while smoothly interpolating mouse positions for fluid distortion.
 */
class PixelatedTextEffect {
  /**
   * Constructor
   *
   * Initializes the effect with configuration options.
   * Sets up mouse state, binds event handlers, and starts initialization.
   *
   * @param {Object} options - Configuration options
   * @param {HTMLElement} options.container - The DOM element to contain the WebGL canvas
   * @param {string} options.text - The text to display and pixelate
   * @param {string} options.font - Font family for the text
   * @param {string} options.color - Background color for the canvas texture
   * @param {string} options.fontWeight - Font weight for the text
   */
  constructor({
    container,
    text = "zayno",
    font = "Rinter",
    color = "#ffffff",
    fontWeight = "100",
  }) {
    this.container = container;
    this.text = text;
    this.font = font;
    this.color = color;
    this.fontWeight = fontWeight;

    this.easeFactor = 0.02;
    this.mousePosition = { x: 0.5, y: 0.5 };
    this.targetMousePosition = { x: 0.5, y: 0.5 };
    this.prevPosition = { x: 0.5, y: 0.5 };

    // Bind event handlers to this instance
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseEnter = this.handleMouseEnter.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);
    this.onWindowResize = this.onWindowResize.bind(this);

    this.init();
  }

  /**
   * createTextTexture
   *
   * Creates a high-resolution canvas texture containing the specified text.
   * The canvas is sized at twice the window dimensions for crisp rendering.
   *
   * The text is drawn centered on the canvas with scaling applied to fit width.
   *
   * Complex calculations:
   * - scaleFactor: scales the text horizontally to fit within the canvas width.
   * - aspectCorrection: corrects vertical scaling to maintain text aspect ratio.
   * - ctx.setTransform: applies scaling and translation to center and size the text.
   *
   * @returns {THREE.CanvasTexture} - A Three.js texture created from the canvas
   */
  createTextTexture() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const canvasWidth = window.innerWidth * 2;
    const canvasHeight = window.innerHeight * 2;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Fill background with specified color (default white)
    ctx.fillStyle = this.color || "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Set font size very large relative to canvas width for crispness
    const fontSize = Math.floor(canvasWidth * 2);

    ctx.fillStyle = "#1a1a1a"; // Text fill color (dark gray)
    ctx.font = `${this.fontWeight} ${fontSize}px "${this.font}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Measure text width to scale text to fit canvas width
    const textMetrics = ctx.measureText(this.text);
    const textWidth = textMetrics.width;

    // scaleFactor ensures the text fits within the canvas width (max scale 1)
    const scaleFactor = Math.min(1, (canvasWidth * 1) / textWidth);

    // aspectCorrection adjusts vertical scale to maintain correct aspect ratio
    const aspectCorrection = canvasWidth / canvasHeight;

    // Apply transform:
    // scaleFactor scales horizontally,
    // scaleFactor / aspectCorrection scales vertically,
    // translate to center of canvas
    ctx.setTransform(
      scaleFactor,
      0,
      0,
      scaleFactor / aspectCorrection,
      canvasWidth / 2,
      canvasHeight / 2
    );

    // Stroke text multiple times for emphasis, then fill text
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = fontSize * 0.005;
    for (let i = 0; i < 3; i++) ctx.strokeText(this.text, 0, 0);
    ctx.fillText(this.text, 0, 0);

    return new THREE.CanvasTexture(canvas);
  }

  /**
   * init
   *
   * Initializes the Three.js scene, camera, renderer, and shader material.
   * Creates the plane mesh with the pixelated text shader and appends the renderer canvas to the container.
   * Starts the animation loop and adds event listeners for interactivity.
   */
  init() {
    this.scene = new THREE.Scene();
    const aspectRatio = window.innerWidth / window.innerHeight;

    // Orthographic camera for 2D rendering
    this.camera = new THREE.OrthographicCamera(
      -1,
      1,
      1 / aspectRatio,
      -1 / aspectRatio,
      0.1,
      1000
    );
    this.camera.position.z = 1;

    // Create text texture for the shader
    const texture = this.createTextTexture();

    // Uniforms passed to the shader
    this.shaderUniforms = {
      u_mouse: { type: "v2", value: new THREE.Vector2() },
      u_prevMouse: { type: "v2", value: new THREE.Vector2() },
      u_texture: { type: "t", value: texture },
    };

    // Vertex shader: pass UV coordinates through to fragment shader
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    // Fragment shader:
    // - Divides the texture into a 40x40 grid for pixelation.
    // - Calculates the center coordinate of each pixel block.
    // - Computes the direction and distance from the pixel to the mouse movement vector.
    // - Applies a ripple distortion moving pixels away from the mouse movement direction.
    // - Samples the texture with the distorted UV coordinates.
    const fragmentShader = `
      varying vec2 vUv;
      uniform sampler2D u_texture;
      uniform vec2 u_mouse;
      uniform vec2 u_prevMouse;
      void main() {
        // Compute grid cell coordinates for pixelation
        vec2 gridUV = floor(vUv * vec2(40.0, 40.0)) / vec2(40.0, 40.0);

        // Center of each pixel block
        vec2 centerOfPixel = gridUV + vec2(1.0/40.0, 1.0/40.0);

        // Direction vector of mouse movement
        vec2 mouseDirection = u_mouse - u_prevMouse;

        // Vector from pixel center to current mouse position
        vec2 pixelToMouseDirection = centerOfPixel - u_mouse;

        // Distance from pixel center to mouse
        float pixelDistanceToMouse = length(pixelToMouseDirection);

        // Strength of distortion decreases smoothly with distance (max near mouse)
        float strength = smoothstep(0.3, 0.0, pixelDistanceToMouse);

        // UV offset applies ripple effect opposite to mouse movement direction
        vec2 uvOffset = strength * -mouseDirection * 0.4;

        // Apply offset to original UV coordinates
        vec2 uv = vUv - uvOffset;

        // Sample the texture with modified UVs for distortion effect
        vec4 color = texture2D(u_texture, uv);

        gl_FragColor = color;
      }
    `;

    // Create a plane mesh covering the viewport with the shader material
    this.planeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.shaderUniforms,
        vertexShader,
        fragmentShader,
      })
    );

    this.scene.add(this.planeMesh);

    // Initialize WebGL renderer with antialiasing
    this.renderer = new THREE.WebGLRenderer({ antialias: true });

    // Set the background color of the WebGL canvas (white)
    this.renderer.setClearColor(0xffffff, 1);

    // Set renderer size and pixel ratio for crisp rendering
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Append the renderer's canvas element to the container
    this.container.appendChild(this.renderer.domElement);

    // Start animation loop
    this.animate();

    // Add event listeners for mouse interaction and resizing
    this.addEventListeners();
  }

  /**
   * addEventListeners
   *
   * Adds event listeners to the container and window for mouse interaction and responsive resizing.
   */
  addEventListeners() {
    this.container.addEventListener("mousemove", this.handleMouseMove);
    this.container.addEventListener("mouseenter", this.handleMouseEnter);
    this.container.addEventListener("mouseleave", this.handleMouseLeave);
    window.addEventListener("resize", this.onWindowResize);
  }

  /**
   * handleMouseMove
   *
   * Updates target mouse position and previous position on mouse move.
   * Increases easing factor for quicker interpolation during movement.
   *
   * @param {MouseEvent} event - Mouse move event
   */
  handleMouseMove(event) {
    this.easeFactor = 0.035;
    const rect = this.container.getBoundingClientRect();
    this.prevPosition = { ...this.targetMousePosition };
    this.targetMousePosition.x = (event.clientX - rect.left) / rect.width;
    this.targetMousePosition.y = (event.clientY - rect.top) / rect.height;
  }

  /**
   * handleMouseEnter
   *
   * Sets easing factor to a lower value for smooth interpolation on mouse enter.
   * Updates mouse and target positions based on current mouse location.
   *
   * @param {MouseEvent} event - Mouse enter event
   */
  handleMouseEnter(event) {
    this.easeFactor = 0.01;
    const rect = this.container.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    this.mousePosition.x = this.targetMousePosition.x = x;
    this.mousePosition.y = this.targetMousePosition.y = y;
  }

  /**
   * handleMouseLeave
   *
   * Sets easing factor to a lower value for smooth interpolation on mouse leave.
   * Resets target mouse position to the previous position to maintain effect continuity.
   */
  handleMouseLeave() {
    this.easeFactor = 0.01;
    this.targetMousePosition = { ...this.prevPosition };
  }

  /**
   * onWindowResize
   *
   * Handles window resizing by updating the camera's orthographic bounds,
   * resizing the renderer, and recreating the text texture to match new size.
   */
  onWindowResize() {
    const aspectRatio = window.innerWidth / window.innerHeight;
    this.camera.left = -1;
    this.camera.right = 1;
    this.camera.top = 1 / aspectRatio;
    this.camera.bottom = -1 / aspectRatio;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.shaderUniforms.u_texture.value = this.createTextTexture();
  }

  /**
   * animate
   *
   * The main animation loop called on each frame.
   * Smoothly interpolates the mouse position towards the target position using easing.
   * Updates shader uniforms with current and previous mouse positions.
   * Renders the scene with the updated shader state.
   */
  animate() {
    this.animationFrame = requestAnimationFrame(this.animate.bind(this));

    this.mousePosition.x +=
      (this.targetMousePosition.x - this.mousePosition.x) * this.easeFactor;
    this.mousePosition.y +=
      (this.targetMousePosition.y - this.mousePosition.y) * this.easeFactor;

    this.shaderUniforms.u_mouse.value.set(
      this.mousePosition.x,
      1.0 - this.mousePosition.y
    );
    this.shaderUniforms.u_prevMouse.value.set(
      this.prevPosition.x,
      1.0 - this.prevPosition.y
    );

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * destroy
   *
   * Cleans up resources and event listeners when the effect is no longer needed.
   * Cancels animation frame, removes event listeners, removes renderer canvas,
   * and disposes of the renderer to free GPU memory.
   */
  destroy() {
    cancelAnimationFrame(this.animationFrame);
    this.container.removeEventListener("mousemove", this.handleMouseMove);
    this.container.removeEventListener("mouseenter", this.handleMouseEnter);
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
    window.removeEventListener("resize", this.onWindowResize);
    this.container.removeChild(this.renderer.domElement);
    this.renderer.dispose();
  }
}

/**
 * applyPixelatedTextTo
 *
 * Utility function to apply the pixelated text effect to a DOM element specified by a selector.
 *
 * - Reads the text content of the target element.
 * - Creates an absolutely positioned overlay div that covers the element.
 * - Ensures the element has a positioning context (relative) for the overlay.
 * - Appends the overlay inside the element.
 * - Instantiates the PixelatedTextEffect with the overlay as the container.
 *
 * @param {string} selector - CSS selector string to identify the target element
 * @param {Object} options - Optional configuration options for PixelatedTextEffect
 * @returns {PixelatedTextEffect|null} - The created effect instance or null if element not found
 */
export function applyPixelatedTextTo(selector, options = {}) {
  const el = document.querySelector(selector);
  if (!el) {
    console.warn(`Element not found for selector: ${selector}`);
    return null;
  }

  const text = el.textContent.trim();
  const overlay = document.createElement("div");
  overlay.classList.add("pixelated-overlay");

  // Apply required styles for overlay:
  // - position absolute to cover the parent element fully
  // - inset 0 to stretch overlay to all edges
  // - z-index 1 to place above other content
  // - pointer-events none to allow mouse events to pass through
  Object.assign(overlay.style, {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    pointerEvents: "none",
  });

  // Ensure parent has positioning context (relative) if static
  if (getComputedStyle(el).position === "static") {
    el.style.position = "relative";
  }

  // Append overlay to the element
  el.appendChild(overlay);

  // Instantiate and return the pixelated text effect
  return new PixelatedTextEffect({
    container: overlay,
    text,
    ...options,
  });
}

export default PixelatedTextEffect;
