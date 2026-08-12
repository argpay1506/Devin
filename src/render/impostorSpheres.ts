import * as THREE from 'three';

const vertexShader = /* glsl */ `
  precision highp float;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;

  in vec3 position;
  in vec3 instanceCenter;
  in float instanceRadius;
  in vec3 instanceColor;

  out vec3 vCenterView;
  out vec3 vViewPos;
  out vec3 vColor;
  out float vRadius;

  void main() {
    vec4 centerView = modelViewMatrix * vec4(instanceCenter, 1.0);
    float scale = length(modelViewMatrix[0].xyz);
    float radius = instanceRadius * scale;

    // Billboard the quad in view space and push it toward the camera by one
    // radius so the ray-marched sphere is never clipped by its own proxy.
    vec3 offset = vec3(position.xy * radius * 1.5, radius);
    vec3 viewPos = centerView.xyz + offset;

    vCenterView = centerView.xyz;
    vViewPos = viewPos;
    vColor = instanceColor;
    vRadius = radius;

    gl_Position = projectionMatrix * vec4(viewPos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  in vec3 vCenterView;
  in vec3 vViewPos;
  in vec3 vColor;
  in float vRadius;

  uniform mat4 projectionMatrix;
  uniform vec3 lightDirection;
  uniform float ambient;
  uniform float opacity;

  out vec4 fragColor;

  void main() {
    // Ray from the eye (origin in view space) through this fragment.
    vec3 rayDir = normalize(vViewPos);
    vec3 toCenter = vCenterView;
    float b = dot(rayDir, toCenter);
    float c = dot(toCenter, toCenter) - vRadius * vRadius;
    float disc = b * b - c;
    if (disc < 0.0) discard;

    float t = b - sqrt(disc);
    if (t < 0.0) discard;

    vec3 hit = rayDir * t;
    vec3 normal = normalize(hit - vCenterView);

    float diffuse = max(dot(normal, normalize(lightDirection)), 0.0);
    vec3 viewDir = normalize(-hit);
    vec3 halfway = normalize(normalize(lightDirection) + viewDir);
    float specular = pow(max(dot(normal, halfway), 0.0), 32.0) * 0.35;
    // Cheap rim term: reads as depth cueing without a real ambient occlusion pass.
    float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0) * 0.15;

    vec3 color = vColor * (ambient + diffuse * (1.0 - ambient)) + specular + rim;
    fragColor = vec4(color, opacity);

    vec4 clip = projectionMatrix * vec4(hit, 1.0);
    gl_FragDepth = (clip.z / clip.w + 1.0) * 0.5;
  }
`;

export interface SphereData {
  centers: Float32Array;
  radii: Float32Array;
  colors: Float32Array;
}

/**
 * Ray-marched sphere impostors: one instanced quad per atom instead of a
 * tessellated sphere mesh. At 100k atoms a 320-triangle sphere mesh would be
 * 32M triangles; the impostor is 2 triangles and yields a pixel-exact sphere
 * with correct depth, which is the only way to hit 60 fps on mobile.
 */
export class ImpostorSpheres {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.RawShaderMaterial;

  constructor(data: SphereData) {
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setIndex(quad.getIndex());
    quad.dispose();

    this.geometry.setAttribute(
      'instanceCenter',
      new THREE.InstancedBufferAttribute(data.centers, 3),
    );
    this.geometry.setAttribute(
      'instanceRadius',
      new THREE.InstancedBufferAttribute(data.radii, 1),
    );
    this.geometry.setAttribute(
      'instanceColor',
      new THREE.InstancedBufferAttribute(data.colors, 3),
    );
    this.geometry.instanceCount = data.radii.length;

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        lightDirection: { value: new THREE.Vector3(0.4, 0.7, 1.0) },
        ambient: { value: 0.35 },
        opacity: { value: 1.0 },
      },
      transparent: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.computeBounds(data.centers, data.radii);
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.opacity.value = opacity;
    this.material.transparent = opacity < 1;
  }

  /** Limits drawing to the first `count` instances, used by the LOD controller. */
  setVisibleCount(count: number): void {
    this.geometry.instanceCount = Math.max(0, Math.min(count, this.capacity));
  }

  get capacity(): number {
    return (this.geometry.getAttribute('instanceRadius') as THREE.BufferAttribute).count;
  }

  updateCenters(centers: Float32Array): void {
    const attribute = this.geometry.getAttribute('instanceCenter') as THREE.BufferAttribute;
    (attribute.array as Float32Array).set(centers);
    attribute.needsUpdate = true;
  }

  updateColors(colors: Float32Array): void {
    const attribute = this.geometry.getAttribute('instanceColor') as THREE.BufferAttribute;
    (attribute.array as Float32Array).set(colors);
    attribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private computeBounds(centers: Float32Array, radii: Float32Array): void {
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < radii.length; i++) {
      point.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]);
      box.expandByPoint(point.clone().addScalar(radii[i]));
      box.expandByPoint(point.clone().addScalar(-radii[i]));
    }
    this.geometry.boundingBox = box;
    this.geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  }
}
