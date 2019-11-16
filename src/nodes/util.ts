export function convertValueType(RED, value, type,
    { defaultType = 'bool', defaultValue = false }: { defaultType?: string, defaultValue?: any } = {}) {
    if (type === 'flow' || type === 'global') {
        try {
            const parts = RED.util.normalisePropertyExpression(value);
            if (parts.length === 0) {
                throw new Error();
            }
        } catch (err) {
            value = defaultValue;
            type = defaultType;
        }
    }
    return { value, type };
}

export function getValue(RED, node, value, type) {
    if (type === 'date') {
        return Date.now();
    } else {
        return RED.util.evaluateNodeProperty(value, type, node);
    }
}

export function R(parts: TemplateStringsArray, ...substitutions: any[]) {
    const rounded = substitutions.map(sub => {
        if (typeof sub === 'number') {
            return Math.round(sub * 10) / 10;
        }
        return sub;
    });
    return String.raw(parts, ...rounded);
}
