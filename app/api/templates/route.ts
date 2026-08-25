import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import templateLibrary from "../../../lib/templateLibrary.json";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const templateId = searchParams.get("id");
        const category = searchParams.get("category");

        // Return all templates
        if (!templateId && !category) {
            // Load source code for all templates
            const templatesWithCode = templateLibrary.templates.map(t => {
                try {
                    const templatePath = path.join(process.cwd(), "contracts", t.file);
                    const code = fs.readFileSync(templatePath, "utf-8");
                    return { ...t, code };
                } catch (err) {
                    console.error(`Failed to load ${t.file}:`, err);
                    return { ...t, code: "// Template code unavailable" };
                }
            });
            
            return NextResponse.json({
                success: true,
                templates: templatesWithCode,
                categories: templateLibrary.categories
            });
        }

        // Return specific template
        if (templateId) {
            const template = templateLibrary.templates.find(t => t.id === templateId);
            
            if (!template) {
                return NextResponse.json({ error: "Template not found" }, { status: 404 });
            }

            // Read template source code
            const templatePath = path.join(process.cwd(), "contracts", template.file);
            const sourceCode = fs.readFileSync(templatePath, "utf-8");

            // Read tutorial if exists
            let tutorial = null;
            try {
                const tutorialPath = path.join(process.cwd(), template.tutorial);
                tutorial = fs.readFileSync(tutorialPath, "utf-8");
            } catch {
                // Tutorial not found - the template is still usable without it.
            }

            return NextResponse.json({
                success: true,
                template: {
                    ...template,
                    sourceCode,
                    tutorial
                }
            });
        }

        // Filter by category
        if (category) {
            const filtered = templateLibrary.templates.filter(t => 
                t.category.toLowerCase() === category.toLowerCase()
            );
            
            return NextResponse.json({
                success: true,
                templates: filtered,
                category: templateLibrary.categories.find(c => 
                    c.id === category.toLowerCase()
                )
            });
        }

        return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    } catch (error) {
            const message = error instanceof Error ? error.message : "Unexpected server error";
        console.error("Templates API Error:", error);
        return NextResponse.json({ 
            success: false, 
            error: message 
        }, { status: 500 });
    }
}
