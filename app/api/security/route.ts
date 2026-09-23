import { NextResponse } from "next/server";

interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  line?: number;
  recommendation: string;
}

/**
 * Static Security Analyzer for Solidity contracts
 * Performs automated security checks before deployment
 */
export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    
    if (!code) {
      return NextResponse.json({ error: "Contract code required" }, { status: 400 });
    }
    
    const issues: SecurityIssue[] = [];
    
    // 1. Check for reentrancy vulnerabilities
    if (code.includes(".call{value:") && !code.includes("ReentrancyGuard") && !code.includes("nonReentrant")) {
      issues.push({
        severity: "critical",
        title: "Potential Reentrancy Vulnerability",
        description: "Contract uses low-level call with value without reentrancy protection",
        recommendation: "Import and use OpenZeppelin's ReentrancyGuard modifier on external functions that transfer value"
      });
    }
    
    // 2. Check for unchecked external calls
    if ((code.includes(".call(") || code.includes(".delegatecall(")) && !code.includes("require") && !code.includes("revert")) {
      issues.push({
        severity: "high",
        title: "Unchecked External Call",
        description: "External calls should always check return values",
        recommendation: "Add require() or if-revert checks after external calls"
      });
    }
    
    // 3. Check for tx.origin usage
    if (code.includes("tx.origin")) {
      issues.push({
        severity: "high",
        title: "Use of tx.origin for Authorization",
        description: "tx.origin should not be used for authorization as it's vulnerable to phishing attacks",
        recommendation: "Use msg.sender instead of tx.origin"
      });
    }
    
    // 4. Check for unchecked arithmetic (pre-0.8.0)
    const pragmaMatch = code.match(/pragma solidity \^?(\d+\.\d+)/);
    if (pragmaMatch) {
      const version = parseFloat(pragmaMatch[1]);
      if (version < 0.8 && !code.includes("SafeMath")) {
        issues.push({
          severity: "critical",
          title: "Integer Overflow/Underflow Risk",
          description: "Solidity < 0.8.0 requires SafeMath library for arithmetic operations",
          recommendation: "Upgrade to Solidity ^0.8.0 or use OpenZeppelin's SafeMath"
        });
      }
    }
    
    // 5. Check for proper access control
    if (!code.includes("Ownable") && !code.includes("AccessControl") && !code.includes("onlyOwner")) {
      if (code.includes("function") && (code.includes("mint(") || code.includes("burn(") || code.includes("withdraw("))) {
        issues.push({
          severity: "high",
          title: "Missing Access Control",
          description: "Privileged functions detected without proper access control",
          recommendation: "Import OpenZeppelin's Ownable or AccessControl and protect sensitive functions"
        });
      }
    }
    
    // 6. Check for denial of service risks with loops
    if (code.match(/for\s*\(/g) && code.includes(".length")) {
      issues.push({
        severity: "medium",
        title: "Potential DoS with Unbounded Loop",
        description: "Loops over dynamic arrays can run out of gas",
        recommendation: "Add limits to array sizes or implement pagination"
      });
    }
    
    // 7. Check for proper event emission
    if (code.includes("function transfer(") && !code.includes("emit Transfer")) {
      issues.push({
        severity: "medium",
        title: "Missing Event Emission",
        description: "State-changing functions should emit events",
        recommendation: "Add event declarations and emit them in critical functions"
      });
    }
    
    // 8. Check for floating pragma
    if (code.includes("pragma solidity ^")) {
      issues.push({
        severity: "low",
        title: "Floating Pragma",
        description: "Using ^ allows compilation with future compiler versions that may have bugs",
        recommendation: "Lock pragma to a specific version for production contracts"
      });
    }
    
    // 9. Check for use of block timestamp
    if (code.includes("block.timestamp") || code.includes("now")) {
      issues.push({
        severity: "low",
        title: "Block Timestamp Dependency",
        description: "Block timestamps can be manipulated by miners within a short range",
        recommendation: "Avoid using timestamps for critical logic or accept ~15 second variance"
      });
    }
    
    // 10. Check for proper visibility
    const functionMatches = code.match(/function\s+\w+\s*\([^)]*\)\s*(?:public|private|internal|external)?/g);
    if (functionMatches) {
      const missingVisibility = functionMatches.filter((f: string) =>
        !f.includes("public") && !f.includes("private") && !f.includes("internal") && !f.includes("external")
      );
      if (missingVisibility.length > 0) {
        issues.push({
          severity: "medium",
          title: "Missing Function Visibility",
          description: "Functions without explicit visibility are public by default in older versions",
          recommendation: "Explicitly declare visibility for all functions"
        });
      }
    }
    
    // 11. Check for OpenZeppelin imports (positive check)
    if (code.includes("@openzeppelin/contracts")) {
      issues.push({
        severity: "info",
        title: "Uses OpenZeppelin Contracts",
        description: "Contract uses battle-tested OpenZeppelin libraries",
        recommendation: "Good practice - continue using audited libraries"
      });
    }
    
    // 12. Check for proper SPDX license
    if (!code.includes("SPDX-License-Identifier")) {
      issues.push({
        severity: "low",
        title: "Missing SPDX License Identifier",
        description: "All source files should specify a license",
        recommendation: "Add // SPDX-License-Identifier: MIT at the top of the file"
      });
    }
    
    // 13. Check for selfdestruct
    if (code.includes("selfdestruct") || code.includes("suicide")) {
      issues.push({
        severity: "critical",
        title: "Use of selfdestruct",
        description: "selfdestruct can permanently destroy contract and funds",
        recommendation: "Remove selfdestruct or add multiple layers of access control with timelock"
      });
    }
    
    // 14. Check for proper constructor
    if (!code.includes("constructor(")) {
      issues.push({
        severity: "info",
        title: "No Constructor Defined",
        description: "Contract has no constructor for initialization",
        recommendation: "Add constructor if initial setup is needed"
      });
    }
    
    // Calculate risk score
    const riskScore = issues.reduce((score, issue) => {
      switch (issue.severity) {
        case "critical": return score + 10;
        case "high": return score + 7;
        case "medium": return score + 4;
        case "low": return score + 2;
        case "info": return score + 0;
        default: return score;
      }
    }, 0);
    
    const riskLevel = riskScore > 20 ? "High Risk" : riskScore > 10 ? "Medium Risk" : riskScore > 5 ? "Low Risk" : "Minimal Risk";

    // Clients display a 0-100 "higher is safer" score. Derive it here so the two
    // representations can never drift apart, and clamp it so a heavily flawed
    // contract reports 0 rather than a negative score.
    const securityScore = Math.max(0, Math.min(100, 100 - riskScore));
    
    // Count by severity
    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const highCount = issues.filter(i => i.severity === "high").length;
    const mediumCount = issues.filter(i => i.severity === "medium").length;
    const lowCount = issues.filter(i => i.severity === "low").length;
    
    // Deployment recommendation
    let deploymentRecommendation = "";
    if (criticalCount > 0) {
      deploymentRecommendation = "DEPLOYMENT NOT RECOMMENDED - Critical vulnerabilities detected. Fix immediately.";
    } else if (highCount > 0) {
      deploymentRecommendation = "DEPLOY WITH CAUTION - High severity issues detected. Review carefully.";
    } else if (mediumCount > 0) {
      deploymentRecommendation = "DEPLOYABLE - Medium issues detected. Consider fixing for production.";
    } else {
      deploymentRecommendation = "SAFE TO DEPLOY - No critical issues detected. Standard best practices followed.";
    }
    
    return NextResponse.json({
      success: true,
      analysis: {
        riskLevel,
        riskScore,
        securityScore,
        deploymentRecommendation,
        summary: {
          critical: criticalCount,
          high: highCount,
          medium: mediumCount,
          low: lowCount,
          info: issues.filter(i => i.severity === "info").length
        },
        issues,
        timestamp: new Date().toISOString(),
        disclaimer: "This is an automated analysis. Professional audit recommended for production contracts."
      }
    });
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Security analysis failed"
    }, { status: 500 });
  }
}
