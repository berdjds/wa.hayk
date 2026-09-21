"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calculator } from "lucide-react";

interface CalculatorFrameProps {
  html: string;
}

export default function CalculatorFrame({ html }: CalculatorFrameProps) {
  const router = useRouter();

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Package Calculator</h1>
          </div>
        </div>
        <p className="hidden text-sm text-muted-foreground sm:inline">
          Hello Armenia Package Calculator 2026
        </p>
      </header>
      <iframe
        title="Hello Armenia Package Calculator 2026"
        srcDoc={html}
        className="w-full flex-1 border-0"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
}
