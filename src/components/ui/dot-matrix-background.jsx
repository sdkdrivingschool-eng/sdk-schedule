import { useEffect, useRef } from 'react'

/**
 * Full-bleed WebGL dot-matrix backdrop — a grid of white dots that flickers
 * between opacity steps and sweeps outward from the centre on mount.
 *
 * The shader is taken verbatim from the reference component. Two deliberate
 * departures from it:
 *
 *  1. `three` is a real dependency loaded with a dynamic import, not a
 *     `<script src="cdnjs…">` tag injected at runtime. A CDN tag is a
 *     third-party request on the sign-in screen, breaks under a strict CSP or
 *     offline, and pins r128 forever. The dynamic import keeps three in its own
 *     lazy chunk, so only screens that use this component pay for it.
 *  2. Failure is silent. No WebGL, or a chunk that won't load, leaves the
 *     parent's black background — the sign-in form must never depend on this.
 */
export default function DotMatrixBackground({ className = '' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let active = true
    let renderer, geometry, material, frame, observer

    import('three')
      .then((THREE) => {
        // The effect may have been torn down while the chunk was in flight.
        if (!active) return

        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: false,
        })
        renderer.setPixelRatio(window.devicePixelRatio)

        const scene = new THREE.Scene()
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

        // u_resolution is intentionally 2x the CSS size: it is the shader's
        // coordinate space, not the drawing buffer, and the 2x is what puts the
        // 20-unit dot pitch at ~10 CSS px on any devicePixelRatio.
        const uniforms = {
          u_time: { value: 0 },
          u_resolution: { value: new THREE.Vector2(2, 2) },
          u_opacities: {
            value: [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1.0],
          },
          u_colors: {
            value: Array.from({ length: 6 }, () => new THREE.Vector3(1, 1, 1)),
          },
          u_total_size: { value: 20.0 },
          u_dot_size: { value: 6.0 },
          u_reverse: { value: 0 },
        }

        material = new THREE.ShaderMaterial({
          vertexShader: `
            precision mediump float;
            uniform vec2 u_resolution;
            out vec2 fragCoord;
            void main() {
              gl_Position = vec4(position, 1.0);
              fragCoord = (position.xy + 1.0) * 0.5 * u_resolution;
              fragCoord.y = u_resolution.y - fragCoord.y;
            }
          `,
          fragmentShader: `
            precision mediump float;
            in vec2 fragCoord;

            uniform float u_time;
            uniform float u_opacities[10];
            uniform vec3 u_colors[6];
            uniform float u_total_size;
            uniform float u_dot_size;
            uniform vec2 u_resolution;
            uniform int u_reverse;

            out vec4 fragColor;

            float PHI = 1.61803398874989484820459;
            float random(vec2 xy) {
                return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
            }

            void main() {
                vec2 st = fragCoord.xy;
                st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
                st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

                float opacity = step(0.0, st.x) * step(0.0, st.y);

                vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

                float frequency = 5.0;
                float show_offset = random(st2);
                float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
                opacity *= u_opacities[int(rand * 10.0)];
                opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
                opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

                vec3 color = u_colors[int(show_offset * 6.0)];

                float animation_speed_factor = 3.0;
                vec2 center_grid = u_resolution / 2.0 / u_total_size;
                float dist_from_center = distance(center_grid, st2);

                float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);

                float current_timing_offset = timing_offset_intro;
                opacity *= step(current_timing_offset, u_time * animation_speed_factor);
                opacity *= clamp((1.0 - step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);

                fragColor = vec4(color, opacity);
                fragColor.rgb *= fragColor.a;
            }
          `,
          uniforms,
          glslVersion: THREE.GLSL3,
          blending: THREE.CustomBlending,
          blendSrc: THREE.SrcAlphaFactor,
          blendDst: THREE.OneFactor,
          transparent: true,
        })

        geometry = new THREE.PlaneGeometry(2, 2)
        scene.add(new THREE.Mesh(geometry, material))

        // Size from the canvas's own box, not window.innerWidth. The reference
        // component used the window, which breaks the moment the backdrop is not
        // the whole viewport — and reports 0 in embedded/headless viewports.
        // `updateStyle: false` leaves the display size to `absolute inset-0`, so
        // there is no inline style competing with the class.
        //
        // The desktop pitch (20-unit grid, 6-unit dot — a ~10 CSS px pitch) is
        // untouched. Below the breakpoint the grid is scaled down to a ~6px
        // pitch at the same dot/pitch ratio: on a phone-sized viewport, a 10px
        // pitch reads as chunky, and — because the intro sweep's duration is
        // driven by how many grid cells fit between the centre and the
        // farthest corner — a small screen at the desktop pitch has so few
        // cells that the "sweep outward" finishes in under a fifth of a
        // second and barely registers. A finer grid restores both the size
        // and the sweep duration together.
        const MOBILE_BREAKPOINT = 640
        const resize = () => {
          const box = canvas.parentElement ?? canvas
          const w = box.clientWidth || window.innerWidth
          const h = box.clientHeight || window.innerHeight
          if (!w || !h) return
          renderer.setSize(w, h, false)
          uniforms.u_resolution.value.set(w * 2, h * 2)

          const isMobile = w < MOBILE_BREAKPOINT
          uniforms.u_total_size.value = isMobile ? 12.0 : 20.0
          uniforms.u_dot_size.value = isMobile ? 3.6 : 6.0
        }
        resize()

        observer = new ResizeObserver(resize)
        observer.observe(canvas.parentElement ?? canvas)

        const startTime = performance.now()
        const animate = () => {
          if (!active) return
          frame = requestAnimationFrame(animate)
          uniforms.u_time.value = (performance.now() - startTime) / 1000
          renderer.render(scene, camera)
        }
        animate()
      })
      .catch((e) => {
        // No WebGL, or the chunk failed: the page keeps its flat black backdrop.
        // Loud in dev, silent in production — a decorative backdrop must never
        // break sign-in, but it shouldn't fail invisibly while developing either.
        if (import.meta.env.DEV) console.error('[dot-matrix] init failed', e)
      })

    return () => {
      active = false
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      material?.dispose()
      geometry?.dispose()
      renderer?.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className}`}
    />
  )
}
