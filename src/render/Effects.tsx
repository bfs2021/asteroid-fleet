import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

/** Loaded lazily: postprocessing is only needed on high quality. */
export default function Effects({ bloom }: { bloom: boolean }) {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        mipmapBlur
        intensity={bloom ? 1.1 : 0}
        luminanceThreshold={1}
        luminanceSmoothing={0.2}
      />
      <Vignette eskil={false} offset={0.2} darkness={0.7} />
    </EffectComposer>
  );
}
