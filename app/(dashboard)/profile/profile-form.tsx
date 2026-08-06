"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { updateMyProfile } from "./actions";

export function ProfileForm({
  fullName,
  dateOfBirth,
  email,
  role,
  company,
}: {
  fullName: string;
  dateOfBirth: string | null;
  email: string;
  role: string;
  company: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(fullName);
  const [dob, setDob] = useState(dateOfBirth ?? "");

  const dirty = name !== fullName || dob !== (dateOfBirth ?? "");
  const canSave = dirty && name.trim().length > 0 && !pending;

  function submit() {
    startTransition(async () => {
      const res = await updateMyProfile({
        full_name: name.trim(),
        date_of_birth: dob || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Profile updated.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="full_name">
            Full name
            <span className="text-destructive" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="full_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="date_of_birth">Date of birth</Label>
          <Input
            id="date_of_birth"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            disabled={pending}
          />
        </div>

        {/* Só leitura de propósito: e-mail vive no auth.users, e role/company são
            do admin (tela Users) — ver profileSelfUpdateSchema. */}
        <div className="grid gap-2">
          <Label>Email</Label>
          <Input value={email} readOnly className="bg-muted" />
        </div>
        <div className="grid gap-2">
          <Label>Role</Label>
          <Input value={role} readOnly className="bg-muted capitalize" />
        </div>
        <div className="grid gap-2">
          <Label>Company</Label>
          <Input value={company} readOnly className="bg-muted" />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button className="sm:min-w-32" onClick={submit} disabled={!canSave}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save changes
        </Button>
      </CardFooter>
    </Card>
  );
}
