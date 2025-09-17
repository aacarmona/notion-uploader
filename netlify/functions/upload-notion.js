// Updated function to correctly parse inline and display math equations
function parseMarkdownWithMath(markdown) {
    // Regex for inline math
    const inlineMathRegex = /\$([^\$]+)\$/g;
    // Regex for display math
    const displayMathRegex = /\$\$([^\$]+)\$\$/g;

    // Replace display math first
    markdown = markdown.replace(displayMathRegex, (match, content) => {
        return `<div class='display-math'>${content}</div>`;
    });

    // Replace inline math
    markdown = markdown.replace(inlineMathRegex, (match, content) => {
        return `<span class='inline-math'>${content}</span>`;
    });

    return markdown;
}