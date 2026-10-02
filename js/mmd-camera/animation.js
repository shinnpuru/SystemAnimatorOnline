// MMDLoader adds VMD translations to each bone's CURRENT local position.
// Build against the bind pose, otherwise switching from a seated/dance pose
// offsets the next motion. Preserve the live pose if building fails.
export function buildInBindPose(builder, data, mesh) {
  const saved = mesh.skeleton.bones.map(bone => ({
    bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone()
  }));
  try { mesh.pose(); return builder.build(data, mesh); }
  finally {
    for (const { bone, position, quaternion, scale } of saved) {
      bone.position.copy(position); bone.quaternion.copy(quaternion); bone.scale.copy(scale);
    }
  }
}
