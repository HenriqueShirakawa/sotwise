"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * `required` marca o campo com asterisco. O botão de submit já fica cinza
 * quando falta obrigatório, mas o cinza só diz "não dá pra clicar" — o
 * asterisco diz qual campo está faltando. Os dois juntos resolvem a "falha
 * silenciosa de validação" reportada no QA.
 */
function Label({
  className,
  required,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      {required ? (
        <span className="-ml-1.5 text-destructive" aria-hidden>
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  )
}

export { Label }
