import { Suspense } from "react";

import { OwnerProfile } from "../_home/owner-profile";
import { Heading, ListSkeleton } from "../ui";

export default function ProfilePage() {
  return (
    <>
      <Heading title="Perfil" />
      <Suspense fallback={<ListSkeleton rows={6} label="Cargando perfil" />}>
        <OwnerProfile />
      </Suspense>
    </>
  );
}
