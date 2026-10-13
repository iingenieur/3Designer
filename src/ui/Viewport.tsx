import { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "../state/store";
import { registerCapture } from "../state/screenshot";

function Model() {
  const mesh = useStore((s) => s.mesh);
  const geometry = useMemo(() => {
    if (!mesh) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  const edges = useMemo(() => {
    if (!mesh) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.edges, 3));
    return g;
  }, [mesh]);
  // 메시가 바뀌면 이전 지오메트리를 GPU에서 해제한다
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => edges?.dispose(), [edges]);
  if (!geometry || !edges) return null;
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#8fb3ff" metalness={0.1} roughness={0.6} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#1f2d4d" />
      </lineSegments>
    </group>
  );
}

/** 서버의 스크린샷 요청이 캔버스를 읽을 수 있게 캡처 함수를 등록한다. */
function ScreenshotBridge() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    // preserveDrawingBuffer 없이도 toDataURL 직전에 한 번 그리면 버퍼가 살아 있다
    registerCapture(() => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    });
    return () => registerCapture(null);
  }, [gl, scene, camera]);
  return null;
}

export function Viewport() {
  return (
    <Canvas camera={{ position: [80, -80, 60], up: [0, 0, 1], fov: 45 }} style={{ background: "#f4f6fa" }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, -50, 100]} intensity={1.2} />
      <directionalLight position={[-50, 50, 30]} intensity={0.4} />
      {/* Grid는 기본 XZ 평면이므로 Z-up 좌표계의 XY 평면으로 돌린다 */}
      <Grid args={[200, 200]} cellSize={10} sectionSize={50} rotation={[Math.PI / 2, 0, 0]} infiniteGrid />
      <axesHelper args={[20]} />
      <Model />
      <OrbitControls makeDefault />
      <ScreenshotBridge />
    </Canvas>
  );
}
